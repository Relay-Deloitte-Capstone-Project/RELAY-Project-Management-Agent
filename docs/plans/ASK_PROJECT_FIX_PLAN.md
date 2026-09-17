# Ask Project — Diagnosis & Fix Plan (LLM pipeline, intent routing, citations, context)

> On approval, this file is also saved as `ASK_PROJECT_FIX_PLAN.md` in the repo root (as requested), then implemented step by step.

---

## 1. What I tested (live, against local backend :8001 + Neon prod DB)

| # | Test question | Result | Verdict |
|---|---|---|---|
| 1 | "What is the mini-project we are building?" | Answered from one random commit chunk ("commits only mention a small refactor…"), 7.4s | **Broken** — no project-overview data exists in the corpus, so the model guesses |
| 2 | "List down all the bugs and code changes." | Returned 2 arbitrary bugs + 4 random commit SHAs from semantic top-5 | **Broken** — pure vector search has no notion of "recent" or "all"; top_k=5 caps it |
| 3 | "What was Sprint-03 about?" | Hallucinated an answer from 5 unrelated commit chunks, all cited | **Broken & dangerous** — zero sprint data in `public.chunks`; model invented a sprint theme |
| 4 | "Tell me about the canary token issue" | Decent answer, but citations included loosely-related chunks | **Partially works** — matches your complaint: near-duplicate tickets get cited even when not really about the query |
| 5 | "What changed in the retrieval rerank logic?" | Good answer, correct commits | Works |
| 6 | "Help me write a python function to sort a list" | Politely declined, 0 sources | Guardrail works (but `abstained:false`) |
| 7 | "What is the capital of France?" | Abstained properly | Guardrail works |

Plus from your screenshot: the commit SHA appears **inline in the prose AND again as a clickable chip** — the frontend renders `[source_doc_id]` chips after text that already contains `[full-40-char-SHA]` inline citations from the LLM. That's the "cited twice" bug.

## 2. Root causes (it's mostly NOT the model)

The fallback chain Groq(gpt-oss-120b) → Gemini(flash) works and gpt-oss-120b writes good prose **when given the right context**. The failures above are retrieval/architecture failures:

1. **One-size-fits-all pipeline** (`backend/api/query.py:run_query`): every question → embed → top-5 cosine → prompt. There is no intent routing. "Sprint-03", "list recent bugs", "what is our project" need *structured* data, not nearest-neighbor chunks.
2. **Corpus gaps**: `public.chunks` has only `jira_ticket` (249) and `github_commit` (821). No sprint metadata (checked metadata keys: status/summary/assignee/priority/created_at/issue_type for tickets; author/date/repo/branch/message/sha_short for commits — **no sprint field**). No project-overview document. Commit chunks store only the message — **no code/diffs**.
3. **No conversation context**: `sessions.send_message` calls `run_query(question=...)` standalone. Follow-ups like "what about the second one?" embed literally and retrieve garbage.
4. **Citation UX**: LLM is told to cite `[KPD-239]` inline; for commits the id is a 40-char SHA so prose is polluted, and the frontend adds chips on top → duplicates. Also `filter_cited_sources` keeps anything the model name-drops, and the model name-drops everything it was handed.
5. **Guardrails exist and work** (0.65 score threshold + "answer ONLY from context" prompt + abstain path) — these must be preserved in every new code path.

## 3. Free LLM options researched

| Provider | Free tier | Models | Notes |
|---|---|---|---|
| **Cerebras** (your find) | 1M tokens/day, 30 req/min, no card | `gpt-oss-120b`, `llama-3.3-70b`, `qwen-3-32b` | OpenAI-compatible API (`https://api.cerebras.ai/v1`), extremely fast (~1s). Same gpt-oss-120b as Groq but different quota pool |
| **Gemini (AI Studio)** | generous free tier | `gemini-2.5-flash` | Best "quality per free quota", 1M context — already integrated |
| **Groq** (current primary) | free daily limits per model | `gpt-oss-120b`, `llama-3.3-70b-versatile` | already integrated |
| **OpenRouter** (your 2nd screenshot) | `:free` model variants, ~50 req/day free | `nvidia/nemotron-3.5-lightning:free`, `nemotron-3-super:free`, others | One API key → many models, OpenAI-compatible; but free tier is heavily rate-limited and model lineup rotates — fine as a 3rd fallback, risky as primary |
| GitHub Models / Mistral / NVIDIA NIM direct | free tiers exist | various | more accounts to manage; not needed |

From your Cerebras dashboard screenshot: `gpt-oss-120b` (Production) gets 1M uncached tokens/day free, `qwen-3.8-27b` gets a much bigger allowance (450 req/min), `gemma-4-31b` is Preview-tier (5 req/min — too tight). So on Cerebras the practical free choices are **gpt-oss-120b** and **qwen-3.8-27b**.

**Recommendation: add Cerebras as a provider (and optionally OpenRouter as last-resort), keep the chain configurable.** All of these are one env-var swap apart — the plan adds `CerebrasProvider` (and a generic OpenAI-compatible provider that also covers OpenRouter) to `backend/api/llm.py` and makes the ordered chain configurable via env (`LLM_PROVIDER`). Two orderings offered at approval (see options below).

## 4. The fix — intent-routed pipeline (keeping all guardrails)

New module `backend/api/intents.py` + rewired `run_query`. Every question is classified FIRST (cheap regex/rules, no extra LLM call for obvious cases):

1. **`summarize_ticket`** — existing shortcut, unchanged ("summarize KPD-33").
2. **`sprint_query`** — matches `sprint[- ]?(\d+|<name>)` + intent words (about/what/plan/goal). Calls the **Jira Agile API live** (`api/jira_client.py` already has `list_sprints` + `sprint_issues`): find the sprint by name, fetch its issues (keys, summaries, statuses), hand that to the LLM with a sprint prompt. If Jira isn't configured or sprint not found → plain "not found" answer, **never hallucinate**. This directly fixes test #3.
3. **`recent_activity`** — matches list/recent/latest/all bugs/code-changes/commits. Runs **SQL against chunk metadata** instead of vector search: e.g. `jira_ticket` where `metadata->>'issue_type'='Bug'` ordered by `created_at` desc limit 8, and/or commits ordered by `date` desc limit 8. LLM structures them into a readable digest with citations. Fixes test #2.
4. **`project_overview`** — matches "what are we building / project about / mini-project / goal". Seed a small number of `project_overview` chunks into `public.chunks` (one-time script `backend/scripts/seed_overview.py` writing a curated description of Relay + the KPD engagement, `source_type='project_overview'`, embedded like other chunks) and point-lookup them. Fixes test #1. **You review/edit the overview text before seeding.**
5. **`code_lookup`** — question is about implementation/code in a cited commit or ticket ("show me the code that fixed X", "what code changed for the webhook fix"). Uses **GitHub API at query time** (`GITHUB_TOKEN` env, repo from chunk metadata e.g. `Anya-Gupta-05/relay-Data-Agent`): fetch the commit diff, keep only the relevant hunks, LLM summarizes + returns a **short snippet (≤15 lines)**, never whole files. If no token configured → falls back to normal RAG. Nothing code-sized is stored in the DB (respects your zone-1 design decision); only the generated summary goes to `zone3.chat_messages` as usual.
6. **default RAG** — existing embed→search→threshold→answer, with `TOP_K` 5→8, per-chunk score floor kept, and prompt tightened: *"Cite only the sources you actually used. For commits cite the short id [sha_short]. Decline anything not about this project in one sentence."*

**Conversation context (your "Kimi-style" memory):** `sessions.send_message` fetches the last 6 messages of the session; if the question looks like a follow-up (short, pronouns, "what about", "and the"), it makes one cheap LLM call to **rewrite it into a standalone question**, which then goes through the normal pipeline (this also fixes retrieval for follow-ups). The last 2 Q&A pairs are also appended to the prompt as conversational context. Everything is still persisted per-user/per-session in `zone3.chat_sessions` / `zone3.chat_messages` — zone model respected: zone1 = raw tickets/commits, zone3 = sessions, messages, generated answers.

**Citation dedup fix:** prompt cites commits as `[467d828]` (sha_short, already in metadata); backend maps short-sha citations back to the full `source_doc_id` for chip rendering; frontend strips `[...]` citation markers from the displayed prose (chips already carry them) → each source appears exactly once, clickable.

**Permission honesty note:** the UI claims "permission checked before retrieval" but the Python backend currently trusts `user_id`/`engagement_id` (flagged in `sessions.py` docstring). This plan does not silently change that; noted here so the team can decide later.

## 5. Implementation steps (after approval)

1. Save this plan as `ASK_PROJECT_FIX_PLAN.md` in repo root.
2. `backend/api/llm.py`: add `CerebrasProvider` (OpenAI-compatible via `openai` SDK or httpx, `CEREBRAS_API_KEY`, `CEREBRAS_MODEL`), make chain order env-configurable; update `backend/.env.example`.
3. `backend/api/intents.py`: classifier + handlers for sprint / recent_activity / project_overview / code_lookup.
4. `backend/api/query.py`: route through intents before RAG; bump TOP_K; prompt updates (short-sha citations, used-sources-only, decline rule).
5. `backend/scripts/seed_overview.py` + overview text (you approve the text) → seed into `public.chunks`.
6. `backend/api/sessions.py`: conversation context (fetch history, rewrite follow-ups, pass context).
7. `backend/api/query.py` response + `src/routes/_authenticated.dev.ask.tsx`: short-sha mapping; strip inline `[...]` markers from rendered text.
8. `code_lookup`: GitHub diff fetch helper (`backend/api/github_client.py`, `GITHUB_TOKEN` env).
9. Re-run the full test matrix (the 7 tests above + follow-up-context test + code-snippet test) and record before/after answers in the plan MD.
10. You review locally at :3000 → then I commit to `Anya-Update-push` and push (auto-deploys Vercel + Render; you'll need to add `CEREBRAS_API_KEY` / `GITHUB_TOKEN` to the Render dashboard).

## 6. What I need from you (manual)

- **Cerebras API key** (you already have the account per the screenshot) → paste into `backend/.env` locally and Render dashboard.
- **GitHub token** with repo read access for the code-lookup feature (can reuse the one from the project-memory work; store it in `backend/.env` only — note: `project-memory-explore/github_token.txt` currently sits inside the repo directory, it should stay out of git / be moved).
- Approval of the 2-3 sentence project-overview text before I seed it.

## 7. Guardrails preserved (explicit)

- Score-threshold abstention stays on every retrieval path; structured paths (sprint/recent) answer only from fetched records and say "not found" plainly when empty.
- Every prompt keeps "answer ONLY from provided context / decline out-of-project requests".
- Refusals cite nothing → `sources: []` → frontend shows the abstain/0-sources state.
- No code files, no full diffs stored in Postgres; snippets capped; all chat artifacts only in `zone3`.
