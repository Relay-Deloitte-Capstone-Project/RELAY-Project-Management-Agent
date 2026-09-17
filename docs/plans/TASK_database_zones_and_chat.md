# DATABASE ARCHITECTURE — Zones + Chat Session Schema

---

## THE THREE ZONES

Three schemas in one PostgreSQL database. Each zone has a different job, different access rules, and different tables.

```
┌─────────────────────────────────────────────────────────┐
│                    PostgreSQL (local Docker)              │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │   ZONE 1     │  │   ZONE 2     │  │   ZONE 3      │  │
│  │   raw.*      │  │   public.*   │  │   zone3.*     │  │
│  │              │  │              │  │               │  │
│  │  Raw data    │  │  Vectors +   │  │  Developer    │  │
│  │  from Jira   │  │  linkage +   │  │  private      │  │
│  │  and GitHub  │  │  permissions │  │  data         │  │
│  └──────────────┘  └──────────────┘  └───────────────┘  │
│                                                          │
│  Ingestion writes    API reads here   Each developer     │
│  here only.          only. RLS on.    sees only their    │
│  API never reads     Vectors live     own sessions       │
│  from raw.           here.            and notes.         │
└─────────────────────────────────────────────────────────┘
```

---

### ZONE 1 — Raw ingestion layer (`raw.*`)

**What it stores:** Everything pulled from Jira and GitHub, exactly as the API returned it. Untouched. Unprocessed. The API never queries this schema directly — only the ingestion pipeline writes here.

**Tables:**
```
raw.jira_tickets      — every ticket with summary, description, status,
                         assignee, comments, raw_payload JSONB
raw.github_commits    — every commit with SHA, message, author, diff,
                         files changed
raw.github_prs        — every PR with title, body, state, review comments,
                         linked jira keys
```

**Who touches it:** Ingestion scripts only. Never the API. Never the frontend. If a developer asks a question, the system searches Zone 2, not Zone 1.

**Why it exists separately:** Raw data has PII (emails), secrets (API keys found by Gitleaks), and unprocessed text. Zone 2 gets cleaned, chunked, embedded copies. Keeping raw data separate means you can re-process it (re-embed with a better model, re-chunk with different sizes) without re-ingesting from the APIs.

---

### ZONE 2 — Vectors + linkage + permissions (`public.*`)

**What it stores:** The processed, searchable layer. Chunks with embeddings, ticket-to-commit links, coverage stats, and the permissions table that controls who sees what.

**Tables:**
```
public.chunks              — cleaned text + vector(384) embedding
                              + source_doc_ids (provenance)
                              + HNSW index for vector search
                              + GIN index for BM25 text search

public.ticket_commit_links — ticket key → commit SHA → PR number
                              (deterministic regex linkage)

public.coverage_stats      — materialised: total tickets, linked count, %

public.user_permissions    — user_id + source_id + can_read boolean
                              + synced_at timestamp
                              (stale > 5 min = DENY, missing = DENY)

public.secrets_findings    — detector type, file path, commit SHA
                              (never stores the actual secret value)
```

**Who touches it:** The query API reads from `public.chunks` for Ask Project. The linkage resolver writes to `ticket_commit_links`. The ACL sync job writes to `user_permissions`. Row-Level Security is ON — queries are scoped by `engagement_id`.

**Why it exists separately:** This is the only schema the API reads from. RLS enforces tenant isolation at the database level. The permission check happens here — before any chunk reaches the LLM. Zone 1 is the warehouse. Zone 2 is the shopfront with a bouncer.

---

### ZONE 3 — Developer private layer (`zone3.*`)

**What it stores:** Per-developer data that nobody else can see. Chat sessions, chat messages, scratchpad notes. Each developer sees only their own rows.

**Tables:** (defined below)
```
zone3.chat_sessions       — one row per conversation thread
zone3.chat_messages       — one row per message in a thread
zone3.message_sources     — one row per citation in an assistant message
zone3.scratchpad_notes    — private knowledge notes (draft / approved / promoted)
```

**Who touches it:** The developer who owns the data. Managers cannot see another developer's chat history or scratchpad. Admin cannot see it either. The only thing visible to others is notes with `status = 'promoted'` — the developer explicitly chose to share those.

**Why it exists separately:** DPDP §4 — personal working notes are the developer's own data. Separating into its own schema makes the boundary physical, not just logical.

---

## HOW THE ZONES CONNECT

```
Zone 1 (raw)                Zone 2 (vectors)              Zone 3 (developer)
─────────────               ────────────────              ──────────────────
raw.jira_tickets  ──clean──→ public.chunks  ──cited in──→ zone3.message_sources
raw.github_commits ─embed─→   (searchable)                    │
raw.github_prs   ──link──→ public.ticket_commit_links     zone3.chat_messages
                           public.user_permissions             │
                              (controls access)            zone3.chat_sessions
```

The flow: raw data gets cleaned, embedded, and stored as searchable chunks in Zone 2. When a developer asks a question, Zone 2 is searched. The answer is stored in Zone 3 with citations pointing back to Zone 2 chunks. If a Zone 2 chunk is later revoked, the Zone 3 citation becomes a tombstone.

---

## ZONE 3 CHAT SESSION SCHEMA

### Table 1: chat_sessions

One row per conversation thread. A developer may have 20 sessions across a week.

```sql
CREATE SCHEMA IF NOT EXISTS zone3;

CREATE TABLE zone3.chat_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    engagement_id   UUID NOT NULL,
    title           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    last_message_at TIMESTAMPTZ
);

CREATE INDEX idx_sessions_user
    ON zone3.chat_sessions (user_id, engagement_id, last_message_at DESC);
```

**Why `last_message_at`:** The sidebar shows recent sessions sorted by last activity. Without this column, every session list query needs a subquery join to find the latest message. This denormalisation saves that join on every page load.

**Why `title` is nullable:** Auto-set from the first user message (first 60 chars). Starts null, updated once.

---

### Table 2: chat_messages

Every message in every session. User messages and assistant messages in the same table.

```sql
CREATE TABLE zone3.chat_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL
                        REFERENCES zone3.chat_sessions(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content         TEXT NOT NULL,
    abstained       BOOLEAN DEFAULT FALSE,
    llm_model       TEXT,
    latency_ms      INTEGER,
    chunk_count     INTEGER,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_session
    ON zone3.chat_messages (session_id, created_at ASC);
```

**Column explanations:**

- `role` — 'user' or 'assistant'. Both in one table, ordered by created_at, gives the full conversation.
- `abstained` — true when the system said "I don't have grounding for that." Only set on assistant messages.
- `llm_model` — 'gemini' / 'groq' / 'ollama'. Only on assistant messages. Powers the indicator: "Gemini · 3 sources · 1.2s"
- `latency_ms` — response time in milliseconds. Only on assistant messages.
- `chunk_count` — how many chunks were retrieved. Only on assistant messages.
- User messages: only `role`, `content`, `created_at` are filled. Other columns stay null.

**Why no vectors on messages:** Chat history is fetched by `session_id ORDER BY created_at`. That is a B-tree index lookup — 2ms. You never semantically search your own chat history. Vectors would cost 1.5KB per row, need HNSW index rebuilds on every write, and add 200ms latency per insert for zero benefit.

**Why no embedded citations in the content text:** Citations live in a separate table (`message_sources`). This way, revoking a citation doesn't require editing the message content. The message text stays intact — only the citation badges change to tombstones.

---

### Table 3: message_sources

One row per citation in an assistant message. The provenance link from Zone 3 back to Zone 2.

```sql
CREATE TABLE zone3.message_sources (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id      UUID NOT NULL
                        REFERENCES zone3.chat_messages(id) ON DELETE CASCADE,
    chunk_id        UUID NOT NULL,
    source_doc_id   TEXT NOT NULL,
    source_type     TEXT NOT NULL,
    relevance_score REAL,
    snippet         TEXT
);

CREATE INDEX idx_sources_message ON zone3.message_sources (message_id);
CREATE INDEX idx_sources_chunk   ON zone3.message_sources (chunk_id);
```

**Column explanations:**

- `chunk_id` — UUID pointing to `public.chunks.id` in Zone 2. This is the provenance link.
- `source_doc_id` — the human-readable label: "KAN-10" or commit SHA. Used for the citation badge text.
- `source_type` — 'jira_ticket' / 'commit' / 'pr_review'. Used for the citation badge icon.
- `relevance_score` — cosine similarity score from retrieval. Used for ordering citations.
- `snippet` — first 200 chars of the chunk content. Used for the citation preview on hover.

**Why a separate table instead of UUID[] on chat_messages:**

1. **Revocation lookup.** "Find every message that cited chunk X" is `WHERE chunk_id = $1` — a B-tree lookup, instant. With UUID[], it would be `WHERE $1 = ANY(cited_chunk_ids)` — requires a GIN index, scans every array.

2. **Display data.** Each citation badge needs source_doc_id, source_type, snippet, and score. Storing all of that as JSONB arrays on the message row gets messy. One row per citation is cleaner.

3. **Tombstoning.** When a source is revoked, you don't delete the message. The message text stays. Only the citation badge changes: "Source no longer available." Separate rows make this a flag toggle, not a text edit.

---

## HOW IT ALL FLOWS

```
Developer asks "why did we build auth with JWT?"
    │
    ├── 1. Create chat_session (if new conversation)
    │       INSERT INTO zone3.chat_sessions (user_id, engagement_id)
    │
    ├── 2. Save user message
    │       INSERT INTO zone3.chat_messages
    │       (session_id, role='user', content='why did we build auth with JWT?')
    │
    ├── 3. Run /api/query pipeline
    │       embed question → search public.chunks → check user_permissions
    │       → generate answer with citations
    │
    ├── 4. Save assistant message
    │       INSERT INTO zone3.chat_messages
    │       (session_id, role='assistant', content='...', llm_model='gemini',
    │        latency_ms=1200, chunk_count=3, abstained=false)
    │
    ├── 5. Save each citation
    │       INSERT INTO zone3.message_sources
    │       (message_id, chunk_id, source_doc_id='KAN-10',
    │        source_type='jira_ticket', relevance_score=0.82,
    │        snippet='JWT was chosen because...')
    │       — repeat for each cited chunk
    │
    └── 6. Update session
            UPDATE zone3.chat_sessions
            SET title = LEFT('why did we build auth with JWT?', 60),
                last_message_at = NOW()
            WHERE id = $session_id AND title IS NULL
```

---

## HOW REVOCATION WORKS ON CHAT HISTORY

```
Admin revokes access to ticket KAN-15
    │
    ├── 1. user_permissions updated: can_read = false for KAN-15
    │
    ├── 2. Developer opens their chat history
    │
    ├── 3. For each assistant message, load message_sources
    │       JOIN with user_permissions to check access
    │
    │       SELECT ms.message_id, ms.source_doc_id,
    │              COALESCE(up.can_read, false) AS still_accessible
    │       FROM zone3.message_sources ms
    │       LEFT JOIN user_permissions up
    │              ON up.source_id = ms.source_doc_id
    │             AND up.user_id = $current_user
    │       WHERE ms.message_id = ANY($message_ids)
    │
    ├── 4. If ONE citation is revoked:
    │       Message text stays visible
    │       That citation badge shows: "Source no longer available"
    │       Snippet is hidden
    │
    └── 5. If ALL citations for a message are revoked:
            Entire message becomes a tombstone:
            "This response referenced content you no longer have access to."
```

---

## WHAT IS NOT IN ZONE 3

- No vectors — chat is chronological, not searchable by similarity
- No other developer's data — strict user_id filtering on every query
- No performance metrics — no velocity, no time tracking, no comparison
- No shared chat history — each developer's sessions are private
- The ONLY path from Zone 3 to visibility is scratchpad promotion (developer explicitly clicks "share with team")
