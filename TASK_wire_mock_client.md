# TASK: Wire Mock Client Data — Audit Jira, Create SOW, Connect Everything
## Claude Code has Jira MCP access. Use it.

---

## CONTEXT — READ THIS FIRST

We are building a tool called Relay. Relay is NOT the mock client project.
Relay INGESTS a mock client project's data and makes it searchable.

Two completely separate things:
```
RELAY = our tool (this codebase, KAN Jira board, idea-explainer-pro repo)
MOCK CLIENT = what Relay eats (separate Jira board, separate GitHub repo)
```

The mock client Jira board already exists with 8 epics and tickets.
Your job: audit what's there, then build everything missing to make the demo work.

---

## STEP 1 — Audit the mock client Jira board

Use Jira MCP to read the existing board. Run these queries:

```
1. List all projects accessible — find the mock client board key
   (it is NOT "KAN" — KAN is Relay's own board)
   
2. List all epics in that project

3. For each epic, list all child tickets with:
   - ticket key
   - summary
   - status (To Do / In Progress / Done)
   - assignee
   - issue type (Story / Task / Bug)

4. Count total tickets
```

Write the results into a file: `mock_client_audit.md`

Format:
```markdown
# Mock Client Audit
## Board: [KEY] — [Project name]
## Total tickets: [N]

### Epic 1: [KEY]-E1 — [Epic name]
- [KEY]-101  [summary]  [status]  [assignee]
- [KEY]-102  [summary]  [status]  [assignee]
...

### Epic 2: [KEY]-E2 — [Epic name]
...
```

**STOP after this step. Show the audit to the user before proceeding.**

---

## STEP 2 — Write a SOW that matches the existing epics

After the audit, create a file `sow_mock_client.md` in the project root.

Rules for writing the SOW:
- One deliverable (D1, D2, D3...) per existing epic
- The deliverable name should closely match the epic name
- Each deliverable has: description, acceptance criteria, EXCLUDES list
- The EXCLUDES list is critical — this is what the Scope Guardian uses
- Make the excludes realistic — things that are adjacent but not contracted

Template per deliverable:
```markdown
D[N]: [Epic name, slightly reworded as a client deliverable]
    [2-3 sentence description of what this covers]
    Acceptance: [concrete criteria — what must work for sign-off]
    EXCLUDES: [2-3 specific things NOT in this deliverable]
```

Add a retention section at the bottom:
```markdown
### RETENTION
All project data retained for 30 days after contract termination.
DPA reference: DPA-MOCK-2026-001.
```

---

## STEP 3 — Plant 3 out-of-scope tickets on the Jira board

Use Jira MCP to CREATE 3 new tickets that deliberately fall OUTSIDE the SOW.

For each ticket:
- Put it in the backlog (no epic assignment)
- Set status: Open
- Set priority: Medium
- Write a realistic summary that sounds like a client request

The three tickets should be:

**Ticket A — clearly out of scope:**
Summary that asks for something the SOW explicitly excludes.
Example: if D2 excludes "mobile app", create a ticket asking for a mobile app.

**Ticket B — clearly out of scope:**
Summary asking for a completely unrelated feature.
Example: if the project is a portal, ask for billing integration.

**Ticket C — deliberately ambiguous:**
Summary that COULD fall under an existing deliverable but is a stretch.
Example: if D3 covers "messaging", create a ticket for "AI-powered auto-replies in messaging" — D3 might cover messaging but the SOW explicitly excludes AI replies.

After creating them, add a comment on each explaining why you created it:
"Test ticket for Scope Guardian demo — expected classification: OUT OF SCOPE"
or "Test ticket — expected classification: AMBIGUOUS"

---

## STEP 4 — Check commit-to-ticket linkage

Look at the mock client GitHub repo (user will provide the URL).

Check if any commit messages reference the Jira ticket keys found in Step 1.

If YES — good, list the linked tickets.
If NO — create a file `link_commits.sh` with commands to create empty linking commits:

```bash
#!/bin/bash
# Run this in the mock client GitHub repo to create ticket references

git commit --allow-empty -m "[KEY]-101 implement [summary from ticket]"
git commit --allow-empty -m "[KEY]-102 add [summary from ticket]"
# ... one per ticket that has status=Done or In Progress
git push
```

Use the actual ticket keys and summaries from Step 1.
Only create commits for tickets that are Done or In Progress — not Open/To Do.

---

## STEP 5 — Create the SOW as structured JSON

After writing `sow_mock_client.md`, also create `sow_mock_client.json`:

```json
{
  "project_key": "[KEY]",
  "client": "[client name from the board]",
  "deliverables": [
    {
      "id": "D1",
      "name": "[from SOW]",
      "description": "[from SOW]",
      "acceptance": "[from SOW]",
      "excludes": ["[item1]", "[item2]", "[item3]"]
    },
    ...
  ],
  "retention_days": 30,
  "dpa_reference": "DPA-MOCK-2026-001",
  "out_of_scope_tickets": [
    {
      "key": "[KEY]-XXX",
      "expected_classification": "out_of_scope",
      "reason": "Violates D[N] exclusion: [specific exclusion]"
    },
    ...
  ]
}
```

This JSON is what the Scope Guardian classification endpoint will read.

---

## STEP 6 — Write a summary of what was done

Create `mock_client_setup_complete.md`:

```markdown
# Mock Client Setup — Complete

## Board: [KEY] — [name]
## Total epics: [N]
## Total tickets: [N] (including 3 planted out-of-scope)

### SOW
- File: sow_mock_client.md
- Deliverables: D1 through D[N]
- Maps to epics: [list]

### Out-of-scope tickets planted
- [KEY]-XXX — [summary] — expected: OUT OF SCOPE
- [KEY]-XXX — [summary] — expected: OUT OF SCOPE  
- [KEY]-XXX — [summary] — expected: AMBIGUOUS

### Commit linkage
- [N] tickets have linked commits
- [N] tickets have no linked commits
- Coverage estimate: [X]%
- Script to create missing links: link_commits.sh

### What Relay needs to ingest
1. Point JIRA_PROJECT_KEY to [KEY]
2. Point GITHUB_REPO to [mock repo URL]
3. Load sow_mock_client.json for Scope Guardian
4. Run ingestion pipeline
5. Verify: Ask Project returns cited answers from this data
```

---

## WHAT NOT TO DO

- Do NOT touch the KAN board — that is Relay's own project board
- Do NOT modify any existing tickets — only READ them and CREATE new ones
- Do NOT delete any epics or restructure the board
- Do NOT create more than 3 out-of-scope tickets
- Do NOT assume ticket keys — read them from the board first

---

## DONE WHEN

- [ ] mock_client_audit.md exists with full ticket listing
- [ ] sow_mock_client.md exists with deliverables matching each epic
- [ ] sow_mock_client.json exists as structured data
- [ ] 3 out-of-scope tickets created on Jira board
- [ ] link_commits.sh exists (if commits don't already reference tickets)
- [ ] mock_client_setup_complete.md summarises everything
- [ ] User has reviewed the audit and confirmed the SOW matches
