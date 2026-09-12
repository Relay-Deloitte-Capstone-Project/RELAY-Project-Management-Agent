"""One-off script: seed `project_overview` chunks into public.chunks.

Ask Project's "what are we building?" intent (api/intents.py) reads these
chunks. The corpus only had jira_ticket + github_commit rows, so any
project-level question was answered from whatever random commit happened to
embed closest.

Idempotent: deletes existing project_overview rows for the engagement and
re-inserts. Run from backend/:
    ../relay_env/bin/python scripts/seed_overview.py

EDIT the OVERVIEW text below first — it is the answer users will read.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import asyncpg  # noqa: E402
from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).parent.parent / ".env")

from api.query import EMBEDDING_MODEL, load_embedding_model, to_pgvector, embed  # noqa: E402

ENGAGEMENT_ID = os.environ.get("RELAY_ENGAGEMENT_ID", "proj-001")

# --- EDIT THIS (keep each entry a self-contained paragraph) -----------------
OVERVIEW = [
    (
        "RELAY-OVERVIEW",
        "Relay is a project management intelligence agent built for a "
        "software consulting engagement. It connects to the team's Jira board "
        "and GitHub repositories, ingests every ticket and commit into a "
        "queryable knowledge base, and lets any team member ask plain-English "
        "questions about the project — what a bug was, what changed, what a "
        "sprint covered — and get an answer grounded in the project's own "
        "records with citations. Its goal is to make project knowledge "
        "instantly accessible: no digging through Jira filters or git log, "
        "and no knowledge lost when someone rolls off the engagement.",
    ),
    (
        "RELAY-ARCHITECTURE",
        "Relay is organized in three data zones. Zone 1 stores raw ingested "
        "records — Jira tickets and GitHub commit metadata — chunked and "
        "embedded in Postgres with pgvector. Zone 2 is the access layer that "
        "checks a user's permissions before derived data is shown. Zone 3 "
        "stores everything generated: chat sessions, chat messages with "
        "citation provenance, and scratchpad notes. The app itself is a "
        "React/TanStack Start frontend, a FastAPI backend that runs the "
        "retrieval pipeline (embed the question, vector-search zone 1, then "
        "answer with an LLM citing its sources), and a Neon Postgres "
        "database. Live Jira and GitHub APIs are called at query time for "
        "sprint data and code diffs, since code itself is never stored.",
    ),
    (
        "KPD-ENGAGEMENT",
        "The current engagement tracked in Relay is 'Apache Kafka' "
        "(Jira project KPD) — a retrieval-augmented generation pipeline for "
        "a client's document search: ingestion, chunking, embedding, "
        "retrieval with reranking, and a cited-answer API, plus the "
        "surrounding security work (secrets scanning, canary tokens, "
        "provenance checks, permission evaluation). The team works in "
        "per-epic sprints on the KPD Jira board, and the work spans the "
        "pipeline itself, CI/eval tooling, and security hardening.",
    ),
]
# ---------------------------------------------------------------------------


async def main():
    model = load_embedding_model()
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        deleted = await conn.execute(
            "DELETE FROM public.chunks WHERE engagement_id = $1 AND source_type = 'project_overview'",
            ENGAGEMENT_ID,
        )
        print("cleared old overview rows:", deleted)
        for doc_id, text in OVERVIEW:
            vec = to_pgvector(embed(model, text))
            await conn.execute(
                """
                INSERT INTO public.chunks (engagement_id, source_type, source_doc_id, content, metadata, embedding)
                VALUES ($1, 'project_overview', $2, $3, '{}'::jsonb, $4::vector)
                """,
                ENGAGEMENT_ID,
                doc_id,
                text,
                vec,
            )
            print("seeded", doc_id)
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
