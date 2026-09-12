# Mock Client Setup — Complete

## Board: KPD — Arclight Systems, Inc. (Arclight Continuity)
## Total epics: 8
## Total tickets: 252 (249 original + 3 planted out-of-scope)

### SOW
- File: `sow_mock_client.md` (human-readable), `sow_mock_client.json` (structured, for Scope Guardian)
- Deliverables: D1 through D8
- Maps to epics: D1↔KPD-1, D2↔KPD-2, D3↔KPD-3, D4↔KPD-4, D5↔KPD-5, D6↔KPD-6, D7↔KPD-7, D8↔KPD-8
- Retention: 30 days after contract termination · DPA reference: DPA-MOCK-2026-001

### Out-of-scope tickets planted
- KPD-250 — Add automatic credential rotation when Secrets Scanning finds a leaked key — expected: OUT OF SCOPE
- KPD-251 — Add Stripe billing and per-seat subscription management to Continuity — expected: OUT OF SCOPE
- KPD-252 — Let Continuity's Q&A assistant auto-answer questions posted in engineering Slack channels — expected: AMBIGUOUS

Each carries a Jira comment explaining why it was created, for anyone auditing the board later.

### Commit linkage
- Repo: `Anya-Gupta-05/relay-Data-Agent` (private) — checked via `gh api`, 869 real commits on `main` (821 original + 48 new).
- Commit messages already reference real KPD ticket keys in several formats (`KPD-239:`, `[KPD-239]`, `(KPD-239)`, `KPD-239 <verb>`, and branch names like `feat/kpd-239-...`).
- 175 of the 241 pre-existing tickets now have at least one linking commit — **71.4% coverage** (up from 51.5%).
- Of the 186 Done/In Progress tickets specifically, 146 are linked (78.5%, up from 52.7%) — **40 still have no commit**.
- 26 To Do tickets already have commits (work started before the ticket status caught up) — expected, not an error.
- The 3 planted out-of-scope tickets (KPD-250/251/252) correctly have zero linkage — no real work exists for them, as intended.
- Script to close the final gap: `link_commits.sh` — regenerated to cover the remaining 40 genuinely-unlinked Done/In Progress tickets.

### PRs — 48 created and merged
No PRs existed on `relay-Data-Agent` before this (0, confirmed via `gh pr list`) despite 29 merged feature branches in its history — those were merged locally, never opened as GitHub PRs.

Created 48 real PRs (branch → empty commit → PR → merge), 8 per real developer, each sourced from that person's own Done/In-Progress tickets that had no commit linkage yet — closing real coverage gap rather than adding disconnected filler:

| Developer | PRs | Tickets |
|---|---|---|
| Priya Kumar | 8 | KPD-42, 48, 87, 93, 94, 102, 105, 107 |
| Jason Maro | 8 | KPD-9, 13, 26, 29, 33, 72, 120, 140 |
| Agrim_Gairola | 8 | KPD-24, 27, 28, 31, 63, 68, 71, 82 |
| Akshar Kher | 8 | KPD-18, 44, 54, 55, 61, 64, 74, 110 |
| Shubhr Aryan | 8 | KPD-69, 106, 111, 141, 159, 164, 167, 191 |
| Omar K | 8 | KPD-16, 25, 32, 35, 115, 116, 119, 247 |

Anya Gupta and Adveita Bhargava were excluded — they have zero assigned tickets (Manager/Admin roles, not developers).

**Known limitation:** every commit's *author* is set correctly per employee (`git commit --author`), so the commit list shows the right name. But every PR's *opener* and pusher is necessarily `Anya-Gupta-05` — the only authenticated GitHub identity available. There's no way around this without separate GitHub accounts/tokens per fictional employee.

### What Relay needs to ingest
1. Point `JIRA_PROJECT_KEY` to `KPD` (already the backend's default)
2. Point `GITHUB_REPO` to `Anya-Gupta-05/relay-Data-Agent`; optionally run `link_commits.sh` there to close the remaining 40-ticket gap
3. Load `sow_mock_client.json` for Scope Guardian
4. Run the ingestion pipeline
5. Verify: Ask Project returns cited answers from this data, and Scope Guardian classifies KPD-250/251 as out-of-scope and KPD-252 as ambiguous
