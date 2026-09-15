"""LLM providers for the answer step.

The chain order is configurable via LLM_PROVIDER_CHAIN (comma-separated,
e.g. "gemini,gemini-lite,groq"); the legacy single-provider LLM_PROVIDER var
is still honored as the primary when LLM_PROVIDER_CHAIN is unset. Any
provider whose API key is missing is silently skipped, so adding a key to
.env is all it takes to join the chain. A provider that fails for any reason
(rate limit included) falls through to the next one automatically.

GEMINI_API_KEYS accepts a comma-separated list of keys from multiple Google
accounts/projects. Each one gets its own "gemini"/"gemini-lite" (then
"gemini-2"/"gemini-lite-2", ...) provider slot in the chain, so once one
account's daily free-tier quota is exhausted the next account's key is tried
automatically, well before falling through to Groq.

Cerebras and OpenRouter are both OpenAI-compatible chat-completions APIs,
so one client covers both — only the base URL, key and model differ.
"""

import json
import os

import httpx
from google import genai
from google.genai import types as genai_types
from groq import AsyncGroq

# Best quality/latency trade-off measured on this corpus.
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")

# gemini-3.6/3.8-flash are slower (~6-7s) and 3.8 degenerates to bare citations;
# 3.5-flash with thinking disabled is the fastest Gemini that still writes prose.
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")

# 3.5-flash's free tier is tiny (5 RPM / 20 RPD), so the lite variant — same
# quality class, much larger allowance (15 RPM / 500 RPD) — is the automatic
# next step before falling all the way back to Groq.
GEMINI_LITE_MODEL = os.environ.get("GEMINI_LITE_MODEL", "gemini-3.5-flash-lite")

# Cerebras free tier: gpt-oss-120b (Production, 1M uncached tokens/day) is the
# practical default; qwen-3.8-27b has a much larger request allowance if the
# gpt-oss quota ever becomes the bottleneck.
CEREBRAS_MODEL = os.environ.get("CEREBRAS_MODEL", "gpt-oss-120b")

# OpenRouter free tier rotates its model lineup; :free variants are rate-limited
# hard (~50 req/day), so this is a last-resort fallback, never the primary.
OPENROUTER_MODEL = os.environ.get("OPENROUTER_MODEL", "nvidia/nemotron-3.5-lightning:free")

# Ordered fallback chain. First configured provider is primary.
CHAIN = [
    p.strip().lower()
    for p in os.environ.get(
        "LLM_PROVIDER_CHAIN", os.environ.get("LLM_PROVIDER", "gemini,gemini-lite,groq")
    ).split(",")
    if p.strip()
]


def _gemini_keys() -> list:
    """One or more Gemini API keys — from different Google accounts/projects
    — so ingestion and Ask Project answers keep working once one account's
    daily free-tier quota is exhausted. GEMINI_API_KEYS takes a comma-
    separated list; GOOGLE_GEMINI_API (this repo's original single-key name)
    or GEMINI_API_KEY still work as a single-key fallback."""
    raw = os.environ.get("GEMINI_API_KEYS", "")
    keys = [k.strip() for k in raw.split(",") if k.strip()]
    if keys:
        return keys
    single = os.environ.get("GOOGLE_GEMINI_API") or os.environ.get("GEMINI_API_KEY")
    return [single] if single else []


def _gemini_key():
    keys = _gemini_keys()
    return keys[0] if keys else None


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
    def __init__(self, api_key: str, model: str, name: str = "gemini", disable_thinking: bool = True):
        self.name = name
        self.model = model
        self.disable_thinking = disable_thinking
        self.client = genai.Client(api_key=api_key)

    async def generate(self, prompt: str) -> str:
        config = genai_types.GenerateContentConfig(
            temperature=0.2,
            # Thinking triples latency for what is an extraction task. Not all
            # variants accept the knob (the lite model 400s on it), so it's
            # only sent for the primary.
            thinking_config=(
                genai_types.ThinkingConfig(thinking_budget=0)
                if self.disable_thinking
                else None
            ),
        )
        resp = await self.client.aio.models.generate_content(
            model=self.model,
            contents=prompt,
            config=config,
        )
        return (resp.text or "").strip()


class OpenAICompatibleProvider:
    """Cerebras / OpenRouter — same request shape, different base URL."""

    def __init__(self, name: str, base_url: str, api_key: str, model: str):
        self.name = name
        self.base_url = base_url
        self.api_key = api_key
        self.model = model

    async def generate(self, prompt: str) -> str:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": self.model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.2,
                },
            )
            resp.raise_for_status()
            data = resp.json()
        return (data["choices"][0]["message"].get("content") or "").strip()


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


async def _gemini_structured_call(prompt: str, schema: "genai_types.Schema") -> str:
    """Runs one structured (JSON-schema) Gemini call, trying each configured
    account's key in turn — so a single account's daily quota running out
    (RESOURCE_EXHAUSTED / 429) doesn't fail the whole ingestion, it just
    moves on to the next account's key."""
    keys = _gemini_keys()
    if not keys:
        raise RuntimeError("No Gemini API key set (GEMINI_API_KEYS, GOOGLE_GEMINI_API or GEMINI_API_KEY)")
    last_error = None
    for api_key in keys:
        try:
            client = genai.Client(api_key=api_key)
            resp = await client.aio.models.generate_content(
                model=GEMINI_MODEL,
                contents=prompt,
                config=genai_types.GenerateContentConfig(
                    temperature=0.1,
                    response_mime_type="application/json",
                    response_schema=schema,
                    thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
                ),
            )
            return resp.text
        except Exception as exc:
            last_error = exc
    raise last_error


async def _extract_via_gemini(text: str) -> dict:
    return json.loads(await _gemini_structured_call(DELIVERABLE_PROMPT.format(text=text), DELIVERABLE_SCHEMA))


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


PM_DOC_TYPES = [
    "charter", "deliverables_matrix", "requirements", "change_request",
    "epic_brief", "sprint_planning", "sprint_review", "retro", "status_report",
    "risk_log", "uat_signoff", "meeting_notes", "unclassified",
]

ENTITY_LIST_SCHEMA = genai_types.Schema(
    type=genai_types.Type.ARRAY, items=genai_types.Schema(type=genai_types.Type.STRING)
)

PM_DOC_SCHEMA = genai_types.Schema(
    type=genai_types.Type.OBJECT,
    properties={
        "doc_type": genai_types.Schema(type=genai_types.Type.STRING, enum=PM_DOC_TYPES),
        "confidence": genai_types.Schema(type=genai_types.Type.NUMBER),
        "notes": genai_types.Schema(type=genai_types.Type.STRING),
        "doc_id": genai_types.Schema(type=genai_types.Type.STRING),
        "scenario": genai_types.Schema(type=genai_types.Type.STRING, enum=["client", "internal"]),
        "doc_version": genai_types.Schema(type=genai_types.Type.STRING),
        "doc_date": genai_types.Schema(type=genai_types.Type.STRING),
        "author": genai_types.Schema(type=genai_types.Type.STRING),
        "doc_status": genai_types.Schema(
            type=genai_types.Type.STRING, enum=["draft", "final", "superseded"]
        ),
        "recurrence_key": genai_types.Schema(type=genai_types.Type.STRING),
        "sections": genai_types.Schema(
            type=genai_types.Type.ARRAY,
            items=genai_types.Schema(
                type=genai_types.Type.OBJECT,
                properties={
                    "section_path": genai_types.Schema(type=genai_types.Type.STRING),
                    "content": genai_types.Schema(type=genai_types.Type.STRING),
                },
                required=["section_path", "content"],
            ),
        ),
        "entities": genai_types.Schema(
            type=genai_types.Type.OBJECT,
            properties={
                "people": ENTITY_LIST_SCHEMA,
                "deliverable_ids": ENTITY_LIST_SCHEMA,
                "requirement_ids": ENTITY_LIST_SCHEMA,
                "risk_ids": ENTITY_LIST_SCHEMA,
                "ticket_refs": ENTITY_LIST_SCHEMA,
                "decision_ids": ENTITY_LIST_SCHEMA,
                "cr_refs": ENTITY_LIST_SCHEMA,
            },
        ),
    },
    required=["doc_type", "confidence", "sections"],
)

PM_DOC_PROMPT = """You are ingesting a PM-tool document into a knowledge base with 12 known
document types. Read the document below and:

1. Classify it as exactly one of: {doc_types}.
   Use "unclassified" if it genuinely doesn't fit any type well, or if you're not
   confident (confidence below 0.6) — do NOT force a low-confidence guess into a real
   type, since a wrong classification corrupts grouping and search filters for every
   other document of that type.
2. Extract front-matter-equivalent fields if present in the text (YAML front matter,
   a title block, etc.) or infer them from context: doc_id (e.g. "CR-002", "EPIC-D8" —
   leave empty for recurring types like status reports that are identified by date
   instead), scenario (client-facing or internal), doc_version, doc_date (YYYY-MM-DD),
   author, doc_status (draft/final/superseded), and recurrence_key — for a RECURRING
   type (sprint_planning, sprint_review, retro, status_report) this is what
   distinguishes one instance from the next, e.g. a week_start date or a sprint number;
   leave it empty for a one-off document like a specific Change Request.
3. Split the document into logical sections matching that doc type's canonical
   structure (e.g. a Risk Log's rows, a Retro's "What Went Well"/"What Went Poorly"/
   "Action Items", a Charter's "Problem"/"Goal"/etc). Each section becomes one
   retrieval chunk, so:
   - Never split a table row, an action item, or a signature block across two sections.
   - Target roughly 150-400 words of content per section; merge very short adjacent
     sections of the SAME document, never merge content across documents.
   - section_path should read like "Retro > What Went Poorly" or
     "Risk & Issue Log > R-02" (for a single logged risk row).
4. Extract entities actually named in the text (do not invent ones): people, deliverable
   IDs (D1-D8 style), requirement IDs (FR-/NFR-), risk IDs (R-/I- style), ticket refs
   (e.g. KPD-123), decision IDs (D-01 style), and change-request refs (CR-001 style).
   Leave any category empty if none appear.

Respond with ONLY a JSON object matching the schema. Never invent content not in the
document — if a field isn't stated or inferable, leave it empty rather than guessing.

DOCUMENT TEXT:
{text}
""".format(doc_types=", ".join(PM_DOC_TYPES), text="{text}")


async def _classify_via_gemini(text: str) -> dict:
    return json.loads(await _gemini_structured_call(PM_DOC_PROMPT.format(text=text), PM_DOC_SCHEMA))


async def _classify_via_groq(text: str) -> dict:
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not set")
    client = AsyncGroq(api_key=api_key)
    resp = await client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[{"role": "user", "content": PM_DOC_PROMPT.format(text=text)}],
        temperature=0.1,
        response_format={"type": "json_object"},
    )
    return json.loads(resp.choices[0].message.content or "{}")


async def classify_document(text: str) -> dict:
    """Structured classification + section-chunking + entity extraction for
    the generic PM-document pipeline (everything except SOW, which has its
    own dedicated extract_deliverables() pipeline).

    Same dual-provider pattern as extract_deliverables: Gemini first for its
    tighter response_schema guarantee, Groq as fallback so an ingestion
    doesn't hard-fail just because one provider is unavailable. Callers
    should treat a low `confidence` (or doc_type == "unclassified") as a
    signal to route the document to human review rather than trusting it.
    """
    try:
        return await _classify_via_gemini(text)
    except Exception as gemini_exc:
        try:
            return await _classify_via_groq(text)
        except Exception as groq_exc:
            raise RuntimeError(
                "Gemini failed ({}); Groq fallback also failed ({})".format(
                    gemini_exc, groq_exc
                )
            ) from groq_exc


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
    """Built once at startup. Ordered by CHAIN; unconfigured providers skipped.

    Every configured Gemini key (GEMINI_API_KEYS) becomes its own provider —
    "gemini"/"gemini-lite" for the first account, "gemini-2"/"gemini-lite-2"
    for the second, etc. — so when generate_answer works through the chain
    and one account's key fails (daily quota exhausted, most commonly), it
    falls through to the next Gemini account before ever reaching Groq.
    """
    available = {}
    gemini_full = [
        GeminiProvider(key, GEMINI_MODEL, name="gemini" if i == 0 else "gemini-{}".format(i + 1))
        for i, key in enumerate(_gemini_keys())
    ]
    gemini_lite = [
        GeminiProvider(
            key, GEMINI_LITE_MODEL,
            name="gemini-lite" if i == 0 else "gemini-lite-{}".format(i + 1),
            disable_thinking=False,
        )
        for i, key in enumerate(_gemini_keys())
    ]
    for provider in gemini_full + gemini_lite:
        available[provider.name] = provider

    if os.environ.get("GROQ_API_KEY"):
        available["groq"] = GroqProvider(os.environ["GROQ_API_KEY"])
    if os.environ.get("CEREBRAS_API_KEY"):
        available["cerebras"] = OpenAICompatibleProvider(
            "cerebras",
            "https://api.cerebras.ai/v1",
            os.environ["CEREBRAS_API_KEY"],
            CEREBRAS_MODEL,
        )
    if os.environ.get("OPENROUTER_API_KEY"):
        available["openrouter"] = OpenAICompatibleProvider(
            "openrouter",
            "https://openrouter.ai/api/v1",
            os.environ["OPENROUTER_API_KEY"],
            OPENROUTER_MODEL,
        )

    ordered = []
    for name in CHAIN:
        if name == "gemini":
            ordered += gemini_full
        elif name == "gemini-lite":
            ordered += gemini_lite
        elif name in available:
            ordered.append(available[name])
    # Anything configured but not named in the chain still joins at the end
    # (covers extra gemini-2/gemini-lite-2/... accounts when the chain only
    # spells out the bare "gemini"/"gemini-lite" tokens, already expanded
    # above, plus any other provider left out of LLM_PROVIDER_CHAIN).
    seen = {id(p) for p in ordered}
    ordered += [p for p in available.values() if id(p) not in seen]
    return ordered


def normalize_answer(answer: str) -> str:
    """Models occasionally cite with full-width brackets 【KPD-27】 or bold
    markers despite the prompt. Normalise citations to ASCII square brackets
    so filter_cited_sources and the frontend's citation stripper both work,
    and drop bold markers (the chat bubble renders plain text).

    Also normalizes typographic hyphen/dash characters some models
    substitute into a citation ID (e.g. "R‑ 01" using U+2011 non-breaking
    hyphen, or an en/em dash) back to a plain ASCII hyphen — otherwise a
    citation like [R‑01] never matches the real id "R-01" and a correct,
    grounded answer silently loses its source attribution."""
    answer = answer.replace("【", "[").replace("】", "]").replace("**", "")
    return answer.replace("‑", "-").replace("–", "-").replace("‐", "-")


async def generate_answer(providers: list, prompt: str) -> tuple:
    """Try each provider in turn; raise the last error if all fail.

    Returns (answer_text, provider_name_used) so callers can report which
    provider actually answered (the primary, or a fallback after it failed).
    """
    if not providers:
        raise RuntimeError(
            "No LLM configured — set CEREBRAS_API_KEY, GROQ_API_KEY or "
            "GOOGLE_GEMINI_API (see backend/.env.example)"
        )
    last_error = None
    for provider in providers:
        try:
            answer = await provider.generate(prompt)
            if answer:
                return normalize_answer(answer), provider.name
            last_error = RuntimeError("{} returned empty text".format(provider.name))
        except Exception as exc:  # fall through to the next provider
            last_error = exc
    raise last_error
