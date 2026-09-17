# TASK: Admin Panel — Project Flow, Setup, Access, Governance
## Build iteratively in this order. Each phase is independently testable.

---

## WHAT EXISTS

- Auth system done: users table, sessions, JWT cookie, role-based routing
- Dev + Manager dashboards done
- `raw.jira_tickets`, `raw.github_commits`, `raw.github_prs` populated
- `public.chunks` with vectors populated
- Admin user: Adveita Bhargava (adveita@relay.dev)

## WHAT THIS BUILDS

Admin gets 7 pages (left sidebar):
1. All projects
2. Project setup (wizard)
3. All users
4. Access control
5. Ingestion logs
6. System health
7. Data governance

Build Phase 1 → test → Phase 2 → test → Phase 3 → test.

---

## DATABASE — run this migration first

```sql
CREATE TABLE IF NOT EXISTS projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    client_name     TEXT NOT NULL,
    jira_project_key TEXT,
    jira_base_url   TEXT,
    jira_api_token  TEXT,
    github_repo_url TEXT,
    github_token    TEXT,
    engagement_id   UUID UNIQUE DEFAULT gen_random_uuid(),
    status          TEXT DEFAULT 'setup'
                        CHECK (status IN ('setup','active','archived')),
    retention_days  INTEGER DEFAULT 30,
    dpa_reference   TEXT,
    start_date      DATE,
    end_date        DATE,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_members (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role          TEXT NOT NULL CHECK (role IN ('developer','manager','observer')),
    added_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS ingestion_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source        TEXT NOT NULL,
    message       TEXT NOT NULL,
    level         TEXT DEFAULT 'info' CHECK (level IN ('info','warn','error')),
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS destruction_certificates (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id    UUID NOT NULL,
    project_name  TEXT NOT NULL,
    chunks_deleted INTEGER,
    certified_at  TIMESTAMPTZ DEFAULT NOW(),
    certified_by  UUID REFERENCES users(id)
);
```

---

## PHASE 1 — All Projects + System Health (2 pages, no wizards)

### Page: All Projects `/admin/projects`

**Layout:**
- Header: "All projects" + "New project" button (blue, top-right)
- One card listing all projects as rows

**Each project row (flex, border-bottom):**
```
● (status dot)  Project name        Status badge    [Setup button or View button]
                Client · Jira key · started date
```

Status dot colors:
- `active` → green dot
- `setup` → purple dot  
- `archived` → grey dot

Status badge: `Active` green / `Setup in progress` amber / `Archived` grey

"New project" button → navigates to `/admin/projects/new`

**API endpoint:**
```python
# GET /api/admin/projects
# Returns all projects with member count

SELECT p.*, COUNT(pm.user_id) as member_count
FROM projects p
LEFT JOIN project_members pm ON pm.project_id = p.id
GROUP BY p.id
ORDER BY p.created_at DESC
```

---

### Page: System Health `/admin/health`

**Layout — 4 metric cards + 2 detail cards:**

Metric cards (4 across):
- Database: "Connected" green dot
- Jira API: "Connected" / "Error" 
- GitHub API: "Connected" / "Error"
- Ollama: "llama3.1:8b ready"

Each card: ping the service on page load, show live status.

**Storage card:**
```
Chunks table:   {count} rows · {size} MB
Zone 3 (chat):  {count} rows · {size} MB
Total:          {total} MB / 500 MB
```

**API to get storage stats:**
```python
# GET /api/admin/health

SELECT
    (SELECT COUNT(*) FROM vectors.chunks) as chunk_count,
    (SELECT COUNT(*) FROM zone3.chat_messages) as message_count,
    (SELECT COUNT(*) FROM zone3.scratchpad_notes) as note_count,
    pg_database_size(current_database()) / 1024 / 1024 as db_size_mb
```

---

## PHASE 2 — Project Setup Wizard (most important part)

### Page: New Project `/admin/projects/new`

A stepped wizard. 5 steps shown as a progress row at the top:

```
[1 Project details] → [2 Jira] → [3 GitHub] → [4 SOW] → [5 Team]
```

Each step: Next button only enabled when required fields are filled. Back button always enabled.

---

**Step 1: Project details**

Fields:
```
Project name        [text input, required]
Client name         [text input, required]
Start date          [date picker]
Expected end date   [date picker]
Description         [textarea, optional]
```

On Next: save to `projects` table with status='setup', get back the `project_id`. Store in local state for remaining steps.

---

**Step 2: Connect Jira**

Fields:
```
Jira base URL       [text, e.g. https://yourcompany.atlassian.net]
Project key         [text, e.g. KAN]
API token           [password input — shown as dots]
Email               [email input — Jira needs email + token]
```

"Test connection" button:
```python
# POST /api/admin/test-jira
# body: { base_url, project_key, api_token, email }
# action: call Jira REST to get project info
# return: { ok: bool, project_name, ticket_count }
```

Show result inline: "✓ Found KAN — 1,247 tickets" or "✗ Authentication failed"

Only enable Next if test passes.

---

**Step 3: Connect GitHub**

Fields:
```
Repository URL      [text, e.g. https://github.com/apache/kafka]
Personal access token [password input]
Branch to track     [text, default: main]
```

"Test connection" button:
```python
# POST /api/admin/test-github
# body: { repo_url, token }
# action: call GitHub API to get repo info
# return: { ok: bool, repo_name, commit_count }
```

Show result: "✓ apache/kafka — 892 commits found" or error.

---

**Step 4: Upload SOW**

```
[Upload PDF or paste text area]

After upload: system parses into structured deliverables.
Show: "Found 6 deliverables — confirm below before continuing"

Editable table:
  D1  [text field for deliverable name]   [text for acceptance criteria]
  D2  ...
  + Add deliverable row

Also: Scope exclusions textarea
  "Anything outside these deliverables is out of scope:"
  [textarea]

Retention policy:
  Retention period   [number input] days after contract end
  DPA reference      [text input]
```

SOW is optional — show "Skip for now" link that goes to Step 5.

---

**Step 5: Assign team members**

```
Search users by name or email: [search input]

Results shown as rows with a role selector:
  ● Ravi Gupta     ravi@relay.dev     [Developer ▾]  [Add]
  ● Jun Rao        jun@relay.dev      [Developer ▾]  [Add]

Already added:
  ● Anya Gupta     anya@relay.dev     Manager        [Remove]

Role options: Developer / Manager / Observer
```

"Finish setup" button → sets project status='active', triggers first ingestion job.

**API:**
```python
# POST /api/admin/projects/{project_id}/members
# body: { user_id, role }

# DELETE /api/admin/projects/{project_id}/members/{user_id}

# POST /api/admin/projects/{project_id}/activate
# Sets status='active', kicks off ingestion, logs to ingestion_logs
```

---

## PHASE 3 — Users, Access Control, Logs, Governance

### Page: All Users `/admin/users`

**3 metric cards:**
- Total users
- Active (logged in last 7 days)
- Inactive

**Users table:**
Columns: Avatar + Name | Email | Role | Projects | Last active | Actions

Each row:
```
[RG] Ravi Gupta    ravi@relay.dev   Developer  [KAN] [REL]   2h ago   [Edit] [Disable]
[AB] Adveita       adveita@relay.dev Admin      all          5m ago   [Edit]
```

Project chips are clickable → go to that project's access control.

"Invite user" button (top-right) → opens a modal:
```
Name    [text]
Email   [text]
Role    [select: Developer / Manager / Admin]
         (Note: Admin role gives system-wide access)
[Send invite]
```

On invite: create user row with temporary password `relay2026`, email shown on screen with copy button. (No actual email sending for the demo.)

**API:**
```python
# GET /api/admin/users
SELECT u.*, MAX(s.created_at) as last_active
FROM users u
LEFT JOIN sessions s ON s.user_id = u.id
GROUP BY u.id
ORDER BY u.name

# POST /api/admin/users
# body: { name, email, role }
# Creates user with bcrypt hash of 'relay2026'

# PATCH /api/admin/users/{id}
# body: { role } or { disabled: true }
```

---

### Page: Access Control `/admin/access`

**Project selector dropdown at top** — switches which project's permissions you're viewing.

**Permissions table for selected project:**
Columns: User | Jira access | GitHub access | Last synced | Action

```
[RG] Ravi     ✓ green    ✓ green    2 min ago    [Revoke]
[JG] Jason    ✓ green    ✗ red      8 min ago    [Revoke] [On leave badge]
```

"Revoke" → sets `user_permissions.can_read = false` for all sources for this user + project. Takes effect on next query (within 5 min sync window).

"Sync now" button (top-right of card) → triggers an immediate permission sync from Jira/GitHub.

**Secrets findings card** (below permissions table):

```
Credentials found in commit history (Gitleaks)

[detector]    [file path]              [commit SHA]    [found]
AWS key       config/test.properties  a3f2b1c         Aug 12 2024
Generic API   scripts/deploy.sh       8e4d9f1         Mar 5 2023

Note: Values are never stored. Only detector type, file path, and commit SHA.
```

---

### Page: Ingestion Logs `/admin/logs`

**Project selector at top** + auto-refresh toggle (every 30s).

**Log stream:**
```
[timestamp]   [source]    [message]                                    [level]
14:22:01      JIRA        Jira sync complete — 12 new, 3 updated        ✓ info
14:22:08      GITHUB      4 new commits, 1 PR merged                    ✓ info
14:22:14      GITLEAKS    Secrets scan — 0 new findings                 ✓ info
14:22:18      EMBED       42 chunks embedded, 8 skipped (secrets)       ⚠ warn
09:15:03      JIRA        Rate limit — retried after 60s                ⚠ warn
```

Level colors: info → muted, warn → amber, error → red.

Filter buttons: All | Info | Warnings | Errors

"Re-ingest" button → POST to `/api/admin/projects/{id}/ingest` which re-runs the ingestion pipeline.

**API:**
```python
# GET /api/admin/logs?project_id=...&level=...&limit=50
SELECT * FROM ingestion_logs
WHERE project_id = $1
  AND ($2 IS NULL OR level = $2)
ORDER BY created_at DESC
LIMIT 50
```

---

### Page: Data Governance `/admin/governance`

Two sections:

**Active projects — retention status:**
```
Project name    Retention     Contract end    Status      Action
Apache Kafka    30 days       Sep 16 2026     Active      [Begin offboarding]
Project Relay   indefinite    —               Active      —
```

"Begin offboarding" → opens a confirmation modal:
```
You are about to begin the offboarding process for Apache Kafka.

This will:
  1. Return all data to the client (you confirm this was done)
  2. Extract a 5-field structural pattern (you review it)
  3. Delete all raw tickets, commits, PRs, embeddings, and chat history
  4. Issue a Certificate of Destruction

This cannot be undone.

[ ] I confirm client data has been returned
[ ] I have reviewed the extracted pattern

[Cancel]  [Begin destruction cascade]
```

On confirm → run the destruction cascade (delete from chunks WHERE engagement_id = X, delete from raw tables WHERE engagement_id = X, insert into destruction_certificates), then mark project as archived.

**Destroyed projects — certificates:**
```
Client X — Q2 engagement
Destroyed: Jul 31 2026 · 4,821 chunks deleted · Certified by: Adveita Bhargava
[Download certificate PDF]
```

**API:**
```python
# POST /api/admin/projects/{id}/offboard
# body: { confirmed: true }
# Steps:
# 1. Extract 5-field pattern → tier1_patterns
# 2. DELETE FROM vectors.chunks WHERE engagement_id = $1
# 3. DELETE FROM raw.jira_tickets WHERE engagement_id = $1
# 4. DELETE FROM raw.github_commits WHERE engagement_id = $1
# 5. DELETE FROM raw.github_prs WHERE engagement_id = $1
# 6. DELETE FROM zone3.chat_messages (via cascade on chat_sessions)
# 7. INSERT INTO destruction_certificates (...)
# 8. UPDATE projects SET status='archived'
# 9. INSERT INTO ingestion_logs (..., message='Destruction cascade complete')
```

---

## SIDEBAR LAYOUT (Admin)

```
RELAY.

PROJECTS
  📋  All projects
  ⚙️  Project setup    ← goes to /admin/projects/new

USERS
  👥  All users
  🔒  Access control

SYSTEM
  🔄  Ingestion logs
  📊  System health
  🗄️  Data governance

─────────────────
● Adveita Bhargava
  Admin
[Sign out]
```

---

## ROUTE STRUCTURE

```
/admin                     → redirect to /admin/projects
/admin/projects            → all projects list
/admin/projects/new        → setup wizard (5 steps)
/admin/projects/{id}       → project detail (future)
/admin/users               → all users + invite
/admin/access              → access control (with project selector)
/admin/logs                → ingestion logs (with project selector)
/admin/health              → system health
/admin/governance          → data governance + offboarding
```

Middleware already guards these routes to ADMIN role only. No change needed.

---

## BUILD ORDER

```
Phase 1 (start here):
  1. Run the migration SQL
  2. Build /admin/projects (list only, no wizard yet)
  3. Build /admin/health
  4. Test: admin can see project list and system status

Phase 2:
  5. Build the 5-step wizard /admin/projects/new
  6. Build the Jira + GitHub test-connection endpoints
  7. Test: create a new project end-to-end

Phase 3:
  8. Build /admin/users + invite modal
  9. Build /admin/access with project selector
  10. Build /admin/logs with filters
  11. Build /admin/governance + destruction modal
  12. Test: full offboarding flow on a test project
```

---

## DONE WHEN

- [ ] Admin can see all projects with status dots
- [ ] Setup wizard creates a project row in 5 steps
- [ ] Jira + GitHub test-connection returns real feedback
- [ ] User invite creates account with relay2026 password
- [ ] Access control table shows live permission status
- [ ] Revoke button updates user_permissions immediately
- [ ] Ingestion logs show real rows from ingestion_logs table
- [ ] System health shows real DB size and row counts
- [ ] Offboarding modal requires two checkboxes before proceeding
- [ ] Destruction cascade deletes from all zone tables
- [ ] Certificate appears in governance page after destruction
- [ ] All admin routes return 403 if non-admin tries to access
