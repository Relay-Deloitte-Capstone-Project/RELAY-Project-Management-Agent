"""LLM providers for the answer step.

Groq is the default: on this corpus it answered in ~1s against ~2.3s for the
fastest usable Gemini model, with better prose and the same citation fidelity.
Gemini stays configured as an automatic fallback, since the Gemini endpoint was
observed returning transient 503s.
"""

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
