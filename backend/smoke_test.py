"""Exercises the retrieval half of /api/query (steps 1-3) without the LLM call.

Run with the venv python from the backend directory:
    .venv/bin/python smoke_test.py
"""

import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")
sys.path.insert(0, str(Path(__file__).parent))

import asyncpg  # noqa: E402

from api.query import (  # noqa: E402
    SEARCH_SQL,
    THRESHOLD,
    TOP_K,
    build_context,
    embed,
    load_embedding_model,
    to_pgvector,
)

GROUNDED = "why did we change read-time permission evaluation?"
UNGROUNDED = "what is the weather in Mumbai?"


async def run(model, pool, question):
    rows = await pool.fetch(
        SEARCH_SQL, to_pgvector(embed(model, question)), "proj-001", TOP_K
    )
    results = [dict(r) for r in rows]
    top = results[0]["score"] if results else 0.0
    abstained = not results or top < THRESHOLD

    print("\nQ: {}".format(question))
    print("   top score : {:.4f}  (threshold {})".format(top, THRESHOLD))
    print("   abstained : {}".format(abstained))
    for r in results:
        print(
            "   - [{}] {} {:.4f} :: {}".format(
                r["source_doc_id"][:12],
                r["source_type"],
                r["score"],
                r["content"][:70].replace("\n", " "),
            )
        )
    if not abstained:
        print("   context chars: {}".format(len(build_context(results))))
    return abstained


async def main():
    print("loading embedding model...")
    model = load_embedding_model()
    pool = await asyncpg.create_pool(os.environ["DATABASE_URL"], min_size=1, max_size=2)
    try:
        grounded_abstained = await run(model, pool, GROUNDED)
        ungrounded_abstained = await run(model, pool, UNGROUNDED)
    finally:
        await pool.close()

    ok = not grounded_abstained and ungrounded_abstained
    print("\n{}: grounded answered, ungrounded abstained".format("PASS" if ok else "FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
