"""Golden-set eval for Ask Project — run after every prompt/intent change.

Loads eval_cases.json, runs each question through the real run_query()
pipeline against the live database (same code path as POST /api/query),
and checks the assertions per case:

    expect_intent    classify() must route to this intent
    abstain          result["abstained"] must equal this
    must_cite        each entry must prefix-match a cited source_doc_id
    must_not_cite    no cited source_doc_id may prefix-match these
    must_mention     each substring (case-insensitive) must appear in the answer
    cited_assignee   every cited jira_ticket chunk's assignee must ILIKE-match

Usage:  cd backend && ../relay_env/bin/python scripts/eval_ask.py [name-filter]
Exit code is 1 if any case fails, so it can gate a push.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(BACKEND_DIR / ".env")

from api import intents  # noqa: E402
from api.llm import build_providers  # noqa: E402
from api.query import load_embedding_model, run_query  # noqa: E402

CASES_PATH = Path(__file__).parent / "eval_cases.json"
ENGAGEMENT_ID = os.environ.get("RELAY_ENGAGEMENT_ID", "proj-001")


async def check_case(pool, embedding_model, llm_providers, case: dict) -> list[str]:
    failures = []

    found = intents.classify(case["question"])
    intent = found[0] if found else None
    if "expect_intent" in case and intent != case["expect_intent"]:
        failures.append("intent: expected {}, got {}".format(case["expect_intent"], intent))

    result = await run_query(
        pool=pool,
        embedding_model=embedding_model,
        llm_providers=llm_providers,
        question=case["question"],
        engagement_id=ENGAGEMENT_ID,
    )
    answer = result["answer"]
    cited = [s["source_doc_id"] for s in result.get("sources", [])]

    if "abstain" in case and result["abstained"] != case["abstain"]:
        failures.append("abstain: expected {}, got {}".format(case["abstain"], result["abstained"]))

    for want in case.get("must_cite", []):
        if not any(c.startswith(want) for c in cited):
            failures.append("must_cite: {} not in {}".format(want, cited))

    for banned in case.get("must_not_cite", []):
        if any(c.startswith(banned) for c in cited):
            failures.append("must_not_cite: {} was cited".format(banned))

    low = answer.lower()
    for phrase in case.get("must_mention", []):
        if phrase.lower() not in low:
            failures.append("must_mention: '{}' not in answer".format(phrase))

    if case.get("cited_assignee") and cited:
        rows = await pool.fetch(
            """SELECT source_doc_id, metadata->>'assignee' AS assignee
               FROM public.chunks
               WHERE source_type = 'jira_ticket' AND source_doc_id = ANY($1::text[])""",
            cited,
        )
        for r in rows:
            if case["cited_assignee"].lower() not in (r["assignee"] or "").lower():
                failures.append(
                    "cited_assignee: {} is assigned to {}".format(r["source_doc_id"], r["assignee"])
                )

    return failures, answer, cited, result.get("provider")


async def main():
    name_filter = sys.argv[1] if len(sys.argv) > 1 else None
    cases = json.loads(CASES_PATH.read_text())
    if name_filter:
        cases = [c for c in cases if name_filter.lower() in c["name"].lower()]
        if not cases:
            print("no case matches", name_filter)
            sys.exit(2)

    print("loading embedding model + providers...")
    embedding_model = load_embedding_model()
    llm_providers = build_providers()
    pool = await asyncpg.create_pool(os.environ["DATABASE_URL"], min_size=1, max_size=2)

    passed = 0
    try:
        for case in cases:
            try:
                failures, answer, cited, provider = await check_case(
                    pool, embedding_model, llm_providers, case
                )
            except Exception as exc:
                failures, answer, cited, provider = ["exception: {}".format(exc)], "", [], None
            status = "PASS" if not failures else "FAIL"
            passed += not failures
            print("\n[{}] {} ({})".format(status, case["name"], provider))
            print("  Q: {}".format(case["question"]))
            for f in failures:
                print("  - {}".format(f))
            if failures:
                print("  cited: {}".format(cited))
                print("  answer: {}".format(answer[:400].replace("\n", " ")))
    finally:
        await pool.close()

    print("\n{}/{} passed".format(passed, len(cases)))
    sys.exit(0 if passed == len(cases) else 1)


if __name__ == "__main__":
    asyncio.run(main())
