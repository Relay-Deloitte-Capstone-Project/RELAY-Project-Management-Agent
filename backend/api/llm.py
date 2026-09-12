"""LLM providers for the answer step.

Groq is the default: on this corpus it answered in ~1s against ~2.3s for the
fastest usable Gemini model, with better prose and the same citation fidelity.
Gemini stays configured as an automatic fallback, since the Gemini endpoint was
observed returning transient 503s.
"""

import json
import os

from google import genai
from google.genai import types as genai_types
from groq import AsyncGroq

# Best quality/latency trade-off measured on this corpus.
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")

# gemini-3.6/3.8-flash are slower (~6-7s) and 3.8 degenerates to bare citations;
# 3.5-flash with thinking disabled is the fastest Gemini that still writes prose.
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")

# Provider tried first; the other one is the fallback.
PRIMARY = os.environ.get("LLM_PROVIDER", "groq").lower()


def _gemini_key():
    # GOOGLE_GEMINI_API is the name used in this repo's .env; the conventional
    # GEMINI_API_KEY is accepted too.
    return os.environ.get("GOOGLE_GEMINI_API") or os.environ.get("GEMINI_API_KEY")


class GroqProvider:
    name = "groq"

    def __init__(self, api_key: str):
        self.client = AsyncGroq(api_key=api_key)

    async def generate(self, prompt: str) -> str:
        resp = await self.client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
        )
        return (resp.choices[0].message.content or "").strip()


class GeminiProvider:
    name = "gemini"

    def __init__(self, api_key: str):
        self.client = genai.Client(api_key=api_key)

    async def generate(self, prompt: str) -> str:
        resp = await self.client.aio.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                temperature=0.2,
                # Thinking triples latency for what is an extraction task.
                thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
            ),
        )
        return (resp.text or "").strip()


DELIVERABLE_SCHEMA = genai_types.Schema(
    type=genai_types.Type.OBJECT,
    properties={
        "deliverables": genai_types.Schema(
            type=genai_types.Type.ARRAY,
            items=genai_types.Schema(
                type=genai_types.Type.OBJECT,
                properties={
                    "name": genai_types.Schema(type=genai_types.Type.STRING),
                    "acceptance_criteria": genai_types.Schema(type=genai_types.Type.STRING),
                    "source_page": genai_types.Schema(type=genai_types.Type.INTEGER),
                },
                required=["name"],
            ),
        ),
        "scope_exclusions": genai_types.Schema(type=genai_types.Type.STRING),
    },
    required=["deliverables"],
)

DELIVERABLE_PROMPT = """You are reading a Statement of Work (SOW) for a software engagement.
Extract every distinct deliverable the vendor is contracted to build, with its
acceptance criteria if the document states one. Also extract anything the
document explicitly marks as out of scope.

Rules:
- Only extract deliverables that are actually in this text — never invent one.
- If a deliverable has no stated acceptance criteria, leave acceptance_criteria empty.
- source_page is the page number (as given by the [page N] markers in the text)
  where this deliverable is primarily described.
- scope_exclusions should be a short plain-text summary, or empty if the
  document states none.
- Respond with ONLY a JSON object shaped exactly like this, no other text:
  {{"deliverables": [{{"name": "...", "acceptance_criteria": "...", "source_page": 1}}],
    "scope_exclusions": "..."}}

SOW TEXT:
{text}
"""


async def _extract_via_gemini(text: str) -> dict:
    api_key = _gemini_key()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY (or GOOGLE_GEMINI_API) is not set")
    client = genai.Client(api_key=api_key)
    resp = await client.aio.models.generate_content(
        model=GEMINI_MODEL,
        contents=DELIVERABLE_PROMPT.format(text=text),
        config=genai_types.GenerateContentConfig(
            temperature=0.1,
            response_mime_type="application/json",
            response_schema=DELIVERABLE_SCHEMA,
            thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
        ),
    )
    return json.loads(resp.text)


async def _extract_via_groq(text: str) -> dict:
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not set")
    client = AsyncGroq(api_key=api_key)
    resp = await client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[{"role": "user", "content": DELIVERABLE_PROMPT.format(text=text)}],
        temperature=0.1,
        # Groq's JSON mode (OpenAI-compatible): guarantees valid JSON syntax,
        # not the field-level schema Gemini's response_schema enforces — the
        # prompt's explicit shape above is what keeps the fields consistent.
        response_format={"type": "json_object"},
    )
    return json.loads(resp.choices[0].message.content or "{}")


async def extract_deliverables(text: str) -> dict:
    """Structured JSON extraction of SOW deliverables.

    Tries Gemini first (its response_schema gives the tightest structural
    guarantee), and falls back to Groq — same one used for Ask Project
    answers — on any Gemini failure (quota exhaustion, outage, etc.) so a
    SOW upload doesn't hard-fail just because one provider is unavailable.
    """
    try:
        return await _extract_via_gemini(text)
    except Exception as gemini_exc:
        try:
            return await _extract_via_groq(text)
        except Exception as groq_exc:
            raise RuntimeError(
                "Gemini failed ({}); Groq fallback also failed ({})".format(
                    gemini_exc, groq_exc
                )
            ) from groq_exc


def build_providers() -> list:
    """Built once at startup. Ordered: primary first, then fallback."""
    available = {}
    if os.environ.get("GROQ_API_KEY"):
        available["groq"] = GroqProvider(os.environ["GROQ_API_KEY"])
    if _gemini_key():
        available["gemini"] = GeminiProvider(_gemini_key())

    ordered = [available[PRIMARY]] if PRIMARY in available else []
    ordered += [p for k, p in available.items() if k != PRIMARY]
    return ordered


async def generate_answer(providers: list, prompt: str) -> tuple:
    """Try each provider in turn; raise the last error if all fail.

    Returns (answer_text, provider_name_used) so callers can report which
    provider actually answered (the primary, or a fallback after it failed).
    """
    if not providers:
        raise RuntimeError(
            "No LLM configured — set GROQ_API_KEY or GOOGLE_GEMINI_API "
            "(see backend/.env.example)"
        )
    last_error = None
    for provider in providers:
        try:
            answer = await provider.generate(prompt)
            if answer:
                return answer, provider.name
            last_error = RuntimeError("{} returned empty text".format(provider.name))
        except Exception as exc:  # fall through to the next provider
            last_error = exc
    raise last_error
