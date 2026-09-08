CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    engagement_id TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('jira_ticket', 'github_commit', 'github_pr', 'confluence_doc')),
    source_doc_id TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    embedding VECTOR(384),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chunks_engagement ON chunks(engagement_id);
CREATE INDEX idx_chunks_source ON chunks(source_type, source_doc_id);
CREATE INDEX idx_chunks_embedding ON chunks USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_chunks_content_tsvector ON chunks USING GIN (to_tsvector('english', content));

-- ivfflat defaults to probing a single list per query, which misses true
-- nearest neighbors on this table (~1000 rows across ~100 lists) — real
-- matches were getting skipped and /api/query answered from irrelevant
-- chunks instead of the right ticket. Setting probes on the role means every
-- new connection gets it automatically, regardless of how the app pools
-- connections (a per-connection SET was tried first and proved unreliable:
-- asyncpg doesn't guarantee which pooled connection serves an request).
ALTER ROLE pm_user SET ivfflat.probes = 10;

CREATE TABLE user_permissions (
    user_id TEXT PRIMARY KEY,
    engagement_id TEXT NOT NULL,
    can_read_jira BOOLEAN DEFAULT TRUE,
    can_read_github BOOLEAN DEFAULT TRUE,
    last_synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    engagement_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT,
    sources JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO user_permissions (user_id, engagement_id, can_read_jira, can_read_github)
VALUES ('demo-user', 'proj-001', TRUE, TRUE)
ON CONFLICT DO NOTHING;
