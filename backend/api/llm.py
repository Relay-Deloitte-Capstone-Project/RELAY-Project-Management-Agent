"""LLM providers for the answer step.

The chain order is configurable via LLM_PROVIDER_CHAIN (comma-separated,
e.g. "gemini,gemini-lite,groq"); the legacy single-provider LLM_PROVIDER var
is still honored as the primary when LLM_PROVIDER_CHAIN is unset. Any
provider whose API key is missing is silently skipped, so adding a key to
.env is all it takes to join the chain. A provider that fails for any reason
(rate limit included) falls through to the next one automatically.

Cerebras and OpenRouter are both OpenAI-compatible chat-completions APIs,
so one client covers both — only the base URL, key and model differ.
"""

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


def build_providers() -> list:
    """Built once at startup. Ordered by CHAIN; unconfigured providers skipped."""
    available = {}
    if os.environ.get("GROQ_API_KEY"):
        available["groq"] = GroqProvider(os.environ["GROQ_API_KEY"])
    if _gemini_key():
        available["gemini"] = GeminiProvider(_gemini_key(), GEMINI_MODEL)
        available["gemini-lite"] = GeminiProvider(
            _gemini_key(), GEMINI_LITE_MODEL, name="gemini-lite", disable_thinking=False
        )
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

    ordered = [available[name] for name in CHAIN if name in available]
    # Anything configured but not named in the chain still joins at the end.
    ordered += [p for k, p in available.items() if k not in CHAIN]
    return ordered


def normalize_answer(answer: str) -> str:
    """Models occasionally cite with full-width brackets 【KPD-27】 or bold
    markers despite the prompt. Normalise citations to ASCII square brackets
    so filter_cited_sources and the frontend's citation stripper both work,
    and drop bold markers (the chat bubble renders plain text)."""
    return answer.replace("【", "[").replace("】", "]").replace("**", "")


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
