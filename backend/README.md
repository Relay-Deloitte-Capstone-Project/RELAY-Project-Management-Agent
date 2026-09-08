# Relay Backend

`POST /api/query` — answers questions about the project from its own Jira/GitHub
records, with citations, and abstains when nothing relevant is indexed.

## Pipeline

```
question ──1─▶ bge-small-en-v1.5 embedding (384d)
          ──2─▶ pgvector cosine search over public.chunks, top 5
          ──3─▶ top score < 0.65 ? abstain : drop any of the 5 that don't clear 0.65 themselves
          ──4─▶ LLM, synthesis prompt over the survivors ─▶ cited answer
```

The embedding model, LLM clients and asyncpg pool are all built once in the
app lifespan ([main.py](main.py)), never per request.

Each indexed chunk is thin — a ticket title plus a sentence or two, or a
one-line commit message — so `TOP_K` in [api/query.py](api/query.py) pulls up
to 5 chunks rather than 2. This corpus has many near-duplicate tickets for the
same underlying issue (different repro notes, follow-ups, sprint context), and
the prompt asks the model to synthesize across them into one descriptive
answer instead of restating a single title. Chunks that don't individually
clear the 0.65 threshold are dropped before that step, so a strong top match
doesn't drag in noise just to pad the count. The prompt also asks for plain
prose, no markdown — the chat UI renders answers as plain text.

**pgvector recall note:** the `ivfflat` index on `chunks.embedding` defaults to
probing 1 of ~100 lists per query, which missed true nearest neighbors on this
table often enough to matter. `database/init.sql` sets
`ivfflat.probes = 10` on the `pm_user` role so every connection gets it
automatically — a per-connection `SET` from the app was tried first and proved
unreliable once the pool held more than one connection.

## LLM choice

Benchmarked on this corpus with the real RAG prompt (all cited correctly):

| Provider | Model | Latency | Notes |
|---|---|---|---|
| **Groq** | **openai/gpt-oss-120b** | **0.97s** | default — best prose |
| Groq | qwen/qwen3.8-27b | 0.70s | fastest, terse |
| Gemini | gemini-3.5-flash (thinking off) | 2.25s | fallback |
| Gemini | gemini-3.1-flash-lite | 1.73s | |
| Gemini | gemini-3.8-flash | 6.19s | degenerates to bare citations |
| Gemini | gemini-3.6-flash | 6.91s | thinking cannot be disabled (400) |

`gemini-2.0-flash` from the original spec is retired and now 404s.

Groq is the default (`LLM_PROVIDER=groq`); the other configured provider is
tried automatically if the first fails, which matters because the Gemini
endpoint was seen returning transient 503s. Swap the default with
`LLM_PROVIDER=gemini`, or change models with `GROQ_MODEL` / `GEMINI_MODEL`.

API keys are read from the repo-root `.env` (`GROQ_API_KEY`,
`GOOGLE_GEMINI_API`); `GEMINI_API_KEY` is accepted as an alias.

## Setup

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env      # keys can also stay in the repo-root .env
```

`backend/.env` is loaded before the repo-root `.env` so its `DATABASE_URL`
(postgres) wins over the root one (Prisma's sqlite file).

Start the database and load the corpus:

```bash
cd ../database
docker compose up -d
docker exec -i relay-postgres psql -U pm_user -d relay_db < relay_db_dump.sql
```

## Run

```bash
.venv/bin/python -m uvicorn main:app --port 8001 --reload
```

Port 8001 rather than 8000 — an unrelated project already binds 8000 on this
machine.

## Test

```bash
# grounded — expect a multi-sentence answer citing [KPD-…] ids, up to 5 sources
curl -X POST http://127.0.0.1:8001/api/query \
  -H "Content-Type: application/json" \
  -d '{"question": "why did we change read-time permission evaluation?"}'

# ungrounded — expect "abstained": true
curl -X POST http://127.0.0.1:8001/api/query \
  -H "Content-Type: application/json" \
  -d '{"question": "what is the weather in Mumbai?"}'
```

`smoke_test.py` checks steps 1–3 (embed, search, threshold) directly against the
database without spending an LLM call:

```bash
.venv/bin/python smoke_test.py
```

## Corpus notes

The indexed data is engagement `proj-001`: 821 GitHub commits and 249 `KPD-*`
Jira tickets. The `KAFKA-*` ids in the original task spec were placeholders and
do not appear in this database.
