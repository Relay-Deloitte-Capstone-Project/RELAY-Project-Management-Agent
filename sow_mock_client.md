# Statement of Work

**Client:** Arclight Systems, Inc.
**Engagement:** Arclight Continuity — Engineering Knowledge & Handover Platform
**Vendor:** Relay Labs (delivery team)
**Jira project:** KPD
**Engagement type:** Fixed-scope build, phased delivery across 8 deliverables (D1–D8)

## Overview

Arclight Systems is building **Continuity**, an internal platform that gives engineering
teams a single, always-current view of project state — where work stands, who has
context on what, and what's safe to hand off when someone rotates off a team. Relay
Labs is contracted to design and build the platform end to end: ingesting Arclight's
existing Jira and GitHub data, making it searchable with citations, generating
handover briefs automatically, enforcing scope boundaries against the signed SOW, and
protecting sensitive data in transit and at rest.

This document defines the eight deliverables that make up the engagement, what each
one includes, the acceptance bar for sign-off, and — critically — what each
deliverable explicitly does **not** cover, so that scope creep can be caught early.

---

## D1: Data Ingestion Connectors (Jira + GitHub)

Build the ingestion layer that pulls issue and commit history from Arclight's Jira and
GitHub organizations into Continuity on a continuing basis, including incremental
sync, webhook-driven updates, and backfill for historical data.

**Acceptance:** Jira issues and GitHub commits/PRs sync within 5 minutes of a change;
a full historical backfill completes without manual intervention; webhook delivery
survives bursts of 50+ events/minute without dropped updates; attachment metadata
(including non-UTF8 filenames) ingests without silent failures.

**EXCLUDES:**
- Connectors for any source control or issue tracker other than Jira and GitHub (no GitLab, Bitbucket, Azure DevOps, Linear, etc.)
- Real-time/streaming ingestion (sub-minute latency) — this deliverable is near-real-time, not streaming
- Migrating or archiving Arclight's data out of Jira/GitHub — Continuity reads, it does not replace the source systems

---

## D2: Ticket-to-Commit Linkage & Coverage Reporting

Automatically associate GitHub commits and PRs with the Jira tickets they implement,
using commit message conventions, and surface a coverage report showing what
percentage of tickets have linked code.

**Acceptance:** Commit messages referencing a ticket key (in any of Arclight's
existing formatting conventions, including parenthetical references) are correctly
linked; the coverage report updates as new commits land; a ticket linking to multiple
commits is not double-counted in coverage percentage.

**EXCLUDES:**
- Sprint velocity, burndown, or estimation-accuracy reporting — this deliverable covers linkage and coverage only, not planning metrics
- Linking tickets across more than one Jira instance (Arclight's Jira only, not any subsidiary or partner org's board)
- Automatically closing or transitioning Jira tickets based on commit/PR activity

---

## D3: Hybrid Search & Cited Q&A

Build a retrieval system over Arclight's ingested project data (tickets, commits, PR
discussions, docs) that supports natural-language questions and returns answers with
citations back to the source ticket or commit.

**Acceptance:** Queries return relevant results combining keyword and semantic
(embedding-based) search; every answer includes at least one citation a user can click
through to the source; retrieval latency stays under 2 seconds at the p95 for a corpus
up to 200k indexed chunks; the system abstains rather than fabricates when it has no
supporting source.

**EXCLUDES:**
- Multi-language translation of source content or answers — English only for this engagement
- A conversational voice interface — this is a text-based Q&A surface only
- Generating new code or making code changes on Arclight's behalf — this deliverable answers questions, it does not write or submit code

---

## D4: Handover Brief & Work-State Assembly

Automatically assemble a handover brief for any engineer — their open tickets, open
PRs, unmerged branches, and recent commit activity — so a manager can see full work
state without asking the person directly.

**Acceptance:** A brief for any team member reflects live Jira/GitHub state at
generation time; briefs correctly show PRs awaiting review from other people, not just
the subject's own open PRs; brief generation does not require the departing engineer
to do anything (no self-reported handover doc).

**EXCLUDES:**
- Any performance, velocity, or productivity scoring of individuals — this deliverable reports work state, not performance judgment
- HR or org-chart data (reporting lines, compensation, review history)
- Automated reassignment of tickets or PRs — the brief surfaces what needs a decision, a human manager makes the call

---

## D5: Scope Guardian — SOW Parsing & Classification

Parse an uploaded Statement of Work into structured deliverables and acceptance
criteria, then classify incoming tickets as in-scope, out-of-scope, or ambiguous
against that parsed SOW.

**Acceptance:** Uploading a SOW (PDF or pasted text) produces an editable deliverable
list the PM can confirm before it goes live; new and existing tickets are classified
against the confirmed deliverables with a stated reason; a written, consistent
definition of "ambiguous" vs. "out-of-scope" is applied so classifications are
explainable, not just a label.

**EXCLUDES:**
- Legal review or redlining of the SOW document itself — Scope Guardian classifies against an already-agreed SOW, it does not negotiate contract terms
- Automatic ticket rejection or closure based on classification — out-of-scope tickets are flagged for PM review, not auto-closed
- Classifying scope for engagements without a parseable SOW on file

---

## D6: Provenance & Read-Time Permission Evaluation

Track where every piece of retrieved information came from (provenance) and evaluate
read access at query time so a user only ever sees data from projects and sources they
currently have permission to access — including immediately after access is revoked.

**Acceptance:** Every citation traces back to its exact source record; a user whose
project access is revoked loses read access to that project's data on their next
query, without requiring a cache flush or system restart; row-level security is
enforced on all tables backing citation-facing data.

**EXCLUDES:**
- Building or replacing Arclight's identity provider / SSO system — Continuity consumes Arclight's existing auth, it does not implement authentication itself
- Formal compliance certification (SOC 2, ISO 27001, etc.) — this deliverable implements the access-control mechanism; certification is a separate, non-contracted process
- Write-access permissions or approval workflows — this deliverable governs reads only

---

## D7: Secrets Scanning & Canary Tokens

Scan ingested commit history for leaked credentials before they're indexed, and embed
canary tokens in seeded/test content to detect unauthorized access or exfiltration.

**Acceptance:** Common secret patterns (API keys, tokens split across adjacent commit
lines, base64-encoded fixtures) are detected before content reaches the searchable
index; a canary token trigger reliably fires an alert, including when the alerting
webhook endpoint itself is briefly unreachable (retried, not dropped); false positives
on legitimate test fixtures are minimized.

**EXCLUDES:**
- Automatically rotating, revoking, or remediating a discovered secret — this deliverable detects and alerts, it does not take remediation action on Arclight's systems
- Scanning artifact stores or secrets managers outside of ingested Git history (no Vault, AWS Secrets Manager, etc. scanning)
- Guaranteeing detection of novel or custom secret formats not matching known patterns

---

## D8: Auto-Draft from PRs — Assisted Capture

When a PR is merged, automatically draft a knowledge-base note summarizing the change
and its reasoning, for a human to review and approve before it's published to the
team's shared knowledge base.

**Acceptance:** A draft is generated per qualifying merged PR without requiring the
author to write anything themselves; drafts sit in a pending state until explicitly
approved; approved notes are searchable through D3's Q&A surface with correct
provenance back to the source PR.

**EXCLUDES:**
- Auto-publishing a draft without human approval — every draft requires explicit sign-off before it becomes part of the shared knowledge base
- Drafting for repositories or PRs outside Arclight's connected GitHub organization
- Translating drafts into languages other than English

---

### RETENTION

All project data retained for 30 days after contract termination.
DPA reference: DPA-MOCK-2026-001.
