"""Writes one .txt timing report per /api/query call, for eyeballing model efficiency.

Files land in backend/reports/, one per request, named by timestamp + a slug of
the question so a run of several questions sorts and reads in order.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path

REPORTS_DIR = Path(__file__).parent.parent / "reports"


def _slug(text: str, max_len: int = 40) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:max_len] or "question"


def write_report(
    *,
    question: str,
    engagement_id: str,
    abstained: bool,
    top_score: float | None,
    provider: str | None,
    answer: str,
    sources: list,
    timings: dict,
) -> Path:
    """timings keys: embed, search, llm, total (all seconds, float). llm/provider
    are absent/None on an abstained request, since step 4 never ran."""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    now = datetime.now(timezone.utc)
    filename = "{ts}_{slug}.txt".format(
        ts=now.strftime("%Y%m%d-%H%M%S"), slug=_slug(question)
    )
    path = REPORTS_DIR / filename

    lines = [
        "Relay — Ask Project query report",
        "=" * 40,
        "timestamp      : {}".format(now.isoformat()),
        "question       : {}".format(question),
        "engagement_id  : {}".format(engagement_id),
        "",
        "-- timing (seconds) --",
        "embed          : {:.3f}".format(timings.get("embed", 0.0)),
        "vector search  : {:.3f}".format(timings.get("search", 0.0)),
        "llm generate   : {:.3f}".format(timings["llm"]) if "llm" in timings else "llm generate   : n/a (abstained)",
        "TOTAL          : {:.3f}".format(timings.get("total", 0.0)),
        "",
        "-- result --",
        "abstained      : {}".format(abstained),
        "top score      : {:.4f}".format(top_score) if top_score is not None else "top score      : n/a",
        "llm provider   : {}".format(provider or "n/a"),
        "sources        : {}".format(
            ", ".join("{} ({})".format(s["source_doc_id"], s["source_type"]) for s in sources)
            or "none"
        ),
        "",
        "-- answer --",
        answer,
        "",
    ]
    path.write_text("\n".join(lines))
    return path
