# TASK: Handover Kit + Onboarding Kit — Manager main pages
## Two new tabs in manager sidebar. Leaving scenario only. All dummy data.

---

## WHAT EXISTS

- Manager sidebar has: Dashboard, Team handover, Scope guardian, Epic progress, Access control
- Team handover page shows a roster of team members
- Remove nothing — just add two new sidebar items

---

## WHAT TO BUILD

Two new pages in the manager sidebar:

```
OVERVIEW
  Dashboard
  Team handover
  Handover kit        ← NEW
  Onboarding kit      ← NEW
  Scope guardian
  Epic progress

CONTROLS
  Access control
```

Routes:
```
/mgr/handover-kit     ← new
/mgr/onboarding-kit   ← new
```

All data is hardcoded dummy data. No API calls. No backend changes.

---

## PAGE 1: HANDOVER KIT `/mgr/handover-kit`

### Scenario: employee is permanently leaving the company

Top of page — person selector. Three developers to choose from:

```
[Ravi Gupta]  [Jason Gustafson]  [David Arthur]
```

Default selected: Ravi Gupta. Clicking a name switches all content below.

Below selector — a status banner:

```
⚠️  Ravi Gupta is leaving the project on Sep 16, 2026.
    Handover kit generated automatically from Jira and GitHub data.
```

---

### Four tabs inside the page:

```
[Work state]  [Assign coverage]  [Knowledge risks]  [Export kit]
```

---

#### Tab 1: Work state

**Three metric cards (top row):**
- Open tickets: 7 (amber)
- Open PRs: 3 (blue)
- Unmerged branches: 2 (red)

**Card: Critical open tickets**

Table with columns: Key | Summary | Status | Priority | Days since last update

Dummy rows:
```
KAFKA-16180  SASL auth token refresh loop          Open       Critical  5d
KAFKA-16245  Consumer group rebalance timeout      In progress  High    0d
KAFKA-16092  Add metrics for partition reassignment In review   Medium  0d
KAFKA-15990  Update consumer offset manager docs   Open         Low    12d
```

Ticket keys in mono blue font.

**Card: Unmerged branches**

Two rows:
```
fix/kafka-16245-rebalance    3 commits ahead · last push 2h ago   [mid-flight]
fix/kafka-16180-auth         1 commit ahead  · last push 3d ago   [stale]
```

Branch names in mono font. Mid-flight = amber badge. Stale = red badge.

**Card: Last 7 days of activity (what was mid-flight)**

Five commit rows:
```
a3f2b1c  Fix token rotation window overlap in SASL handler      2h ago
8e4d9f1  WIP: rebalance timeout — partial implementation        3d ago
c7a1e2f  PR review: suggested atomic compare-and-swap           4d ago
b2d9e11  Add unit test for offset commit flow                   5d ago
f4a8c23  Refactor SASL handshake retry logic                    6d ago
```

Commit SHAs in mono blue (7 chars). Timestamps right-aligned muted.

---

#### Tab 2: Assign coverage

Heading: "Assign each open item to a team member before Ravi leaves."

**Section: Ticket coverage**

For each open ticket — one row with:
- Ticket key chip (mono blue)
- Summary (truncated)
- Dropdown: "Select team member" — options: Jun Rao, Jason Gustafson, David Arthur, Priya Sharma
- Urgency pills: [Critical] [High] [Medium] — clickable, one active at a time

Pre-fill KAFKA-16245 with "Jun Rao" assigned and "High" urgency selected to show the pattern.

**Section: Branch ownership**

For each branch — one row:
- Branch name in mono
- Dropdown: "Assign owner" — same team members
- Decision dropdown: "Take over" / "Merge as-is" / "Close with note"

**Section: Manager handover note**

Label: "Add context the system can't infer"
Textarea with placeholder: "e.g. Ravi was mid-discussion with the platform team about the auth redesign. The approach in KAFKA-16180 is not final — talk to Jun before merging."

**Bottom row of buttons:**
```
[Preview email to team]  [Export as Markdown]  [Confirm assignments →]
```

All three buttons are ghost style. Clicking any shows a toast: "This would notify the team in production."

---

#### Tab 3: Knowledge risks

Heading: "What only Ravi knows — inferred from commit history"

**Three risk items stacked:**

Risk item 1 (red — high):
```
🔴  SASL auth module — Ravi authored 87% of commits in the last 6 months
    No other team member has touched this module. If the unmerged branch
    isn't transferred, the context is lost permanently.
```

Risk item 2 (amber — medium):
```
🟡  Consumer rebalance fix — only one PR review thread explains the approach
    Ravi answered Jun's question in PR #16789 but the reasoning was never
    captured in a scratchpad note.
```

Risk item 3 (green — low):
```
🟢  Partition metrics endpoint — well documented, 3 linked commits,
    PR description is thorough. Safe to hand over without a knowledge transfer.
```

**Documentation coverage bars (below risk items):**

Three horizontal bars:
```
SASL / auth module           ██░░░░░░░░  12%   (red)
Consumer group rebalance     ████░░░░░░  38%   (amber)
Partition metrics            ████████░░  74%   (green)
```

**Recommended actions card (amber border):**

```
💡 Before Ravi's last day:

1. Ask Ravi to approve the auto-draft note from PR #16801
   (currently pending in his scratchpad)

2. Schedule a 30-min knowledge transfer for the SASL module
   with whoever takes over KAFKA-16180

3. KAFKA-16180 branch needs a decision: merge as-is, assign new
   owner, or close with a detailed note
```

---

#### Tab 4: Export kit

Left card: "What's included"

Checklist (all checked, green):
```
✓  Open ticket list with status and priority
✓  Open PRs and who is blocked waiting
✓  Unmerged branches with staleness
✓  Last 10 commits with messages
✓  Coverage gaps (modules only Ravi has context for)
✓  Approved scratchpad notes
✓  Handover assignments (filled in Tab 2)
✓  Manager's handover note
```

Right card: "What's NOT included"

Checklist (all ✗, red/muted):
```
✗  Velocity or time-to-resolve metrics (personal data — DPDP §4)
✗  Performance comparison to other developers
✗  Effort predictions
✗  Any data from other client projects
```

Small note below: "This kit contains work state, not performance judgment."

**Export buttons row:**
```
[Preview full kit]  [Copy as Markdown]  [Export PDF]
```

All show toast: "This would export in production."

---

### Dummy data for Jason Gustafson and David Arthur

When user clicks Jason or David in the person selector, all numbers and tickets change. Keep it simple:

Jason Gustafson:
- 5 open tickets, 2 open PRs, 1 unmerged branch
- Tickets: KAFKA-15901 (In progress, High), KAFKA-15834 (Open, Medium), KAFKA-15790 (Open, Low)
- Risk: Consumer protocol module (60% Jason's commits) — medium risk

David Arthur:
- 3 open tickets, 1 open PR, 0 unmerged branches
- Tickets: KAFKA-14210 (In review, High), KAFKA-14198 (Open, Medium)
- Risk: Storage engine (40% David's commits) — low risk

---

## PAGE 2: ONBOARDING KIT `/mgr/onboarding-kit`

### Scenario: new developer joining the team

Top of page — new person name field + "Generate kit" button:

```
New developer name:  [Priya Sharma          ]   [Generate kit →]
```

On clicking Generate kit — same page fills with content below.
Show it pre-filled with "Priya Sharma" on page load so there is content to see.

No tabs — this page is a single vertical scroll with sections.

---

### Section 1: Project orientation

**Card: What this project is**

```
Apache Kafka — Q3 2026 Engagement

This is a distributed streaming platform maintained by the Apache Software
Foundation. The team is currently focused on three areas: the KRaft consensus
protocol migration (replacing Zookeeper), consumer group protocol v2, and
observability improvements.

The codebase is primarily Java. The main repo is apache/kafka on GitHub.
Jira project key: KAN. Currently 1,247 tickets, 892 indexed commits.
```

Style: serif font, slightly larger text, card with left blue border — editorial feel.

**Card: Active work this sprint**

Three rows, one per epic:
```
KRaft consensus migration      ████████████░░  On track    14 open tickets
Consumer group protocol v2     ██████░░░░░░░░  At risk      18 open tickets
Observability + metrics        ████░░░░░░░░░░  Stalled       8 open tickets
```

**Card: Known landmines**

Three notes with amber left border (these come from "promoted" scratchpad notes):
```
⚠  KRaft leader election edge case
   The epoch number must increment BEFORE the replay, not after —
   otherwise followers reject entries as stale. Ask Jun about this.

⚠  Partition reassignment throttle
   Only applies to inter-broker traffic. Intra-broker moves are
   unthrottled and can saturate disk I/O. Check log.dirs config first.

⚠  SASL auth token refresh
   The rotation window had no overlap — a 30-second grace period was
   added. See PR #16801 for the fix and reasoning.
```

---

### Section 2: The team

**Card: Who owns what**

Table — three columns: Area | Primary owner | Contact

```
SASL / auth module          Ravi Gupta      87% of commits — ask Ravi first
Consumer protocol           Jun Rao         Main contributor to KRaft work
Storage engine              David Arthur    All log compaction and retention
Partition metrics           Jason Gustafson Observability + JMX endpoints
```

"This is inferred from commit history, not self-reported." — muted caption below.

**Card: Who reviews what**

Three rows:
```
Backend / core changes      →  Jun Rao (reviewed 34 PRs)
Auth + security PRs         →  Ravi Gupta (reviewed 21 PRs)
Performance + storage       →  David Arthur (reviewed 18 PRs)
```

---

### Section 3: The codebase

**Card: Most active files this sprint**

Five rows:
```
clients/src/main/java/org/apache/kafka/clients/consumer/    23 commits
core/src/main/scala/kafka/server/                           18 commits
clients/src/main/java/org/apache/kafka/common/security/     14 commits
core/src/main/scala/kafka/coordinator/group/                11 commits
tests/kafkatest/                                             9 commits
```

File paths in mono font. "Start here to understand current focus." — muted caption.

**Card: Recent bugs fixed — read these first**

Three rows:
```
KAFKA-16180  SASL auth token refresh loop                  Fixed in a3f2b1c
KAFKA-16092  Partition reassignment metric was off by one  Fixed in 8e4d9f1
KAFKA-15834  Consumer group coordinator NPE on restart     Fixed in c7a1e2f
```

"Reading bug fixes is the fastest way to understand the system's weak points."

**Card: Coverage map**

Two columns:
```
Well documented (safe to explore)    Dark areas (no linked commits)
─────────────────────────────────    ──────────────────────────────
KRaft consensus      72% linked      Consumer protocol   38% linked
Partition metrics    74% linked      Observability       28% linked
Auth module          12% linked ⚠️
```

"The auth module has almost no linked commits — high knowledge risk area."

---

### Section 4: Your first week

**Card: Suggested first ticket**

```
KAFKA-16092 — Add metrics for partition reassignment

Why this ticket:
  ✓  Medium complexity — not trivial, not overwhelming
  ✓  Well documented — 3 linked commits, thorough PR description
  ✓  Not on the critical path — safe to take time to understand
  ✓  Jun Rao is familiar with it and available to answer questions

Status: In review · Priority: Medium · Epic: Observability
```

Card has a light blue border. "This recommendation is based on ticket complexity, documentation coverage, and current team load."

**Card: Key PRs to read first**

Five rows — most-commented PRs:
```
PR #16789   Token refresh edge case — 14 comments, Jun + Ravi debating approach
PR #16650   KRaft leader election fix — 11 comments, core architecture discussion
PR #16340   Consumer group v2 protocol — 9 comments, design decision documented
PR #15901   Rebalance timeout investigation — 8 comments, root cause analysis
PR #15420   SASL handshake retry — 7 comments, security implications
```

"These are where the biggest technical debates happened. Reading them gives you 80% of the architectural reasoning."

**Card: 30-day milestones**

Manager-editable in production. Show as a static checklist for demo:
```
□  Day 3:   First PR opened (even if small)
□  Day 7:   First PR merged to main
□  Day 14:  First feature ticket taken independently
□  Day 30:  Autonomous contributor — no hand-holding needed
```

Muted caption: "Teams that set explicit milestones cut new-hire ramp time from 6 weeks to 10 days."

---

## STYLING NOTES

- Same card shell, sidebar, and topbar as the rest of the manager panel
- Risk items (Tab 3 of Handover): use left border only — red/amber/green, no bg tint
- Onboarding landmine notes: amber left border, slightly warm card bg
- Suggested first ticket card: blue left border
- All progress bars: 4px height, rounded, same green/amber/red thresholds as epics (>70% green, 40-70% amber, <40% red)
- Person selector on Handover: three pill buttons, active one filled blue
- No animations except the tab switch (instant, no transition needed)

---

## DONE WHEN

- [ ] "Handover kit" appears in manager sidebar, navigates to `/mgr/handover-kit`
- [ ] "Onboarding kit" appears in manager sidebar, navigates to `/mgr/onboarding-kit`
- [ ] Person selector on Handover kit switches all content (Ravi / Jason / David)
- [ ] All four tabs on Handover kit render correct dummy content
- [ ] Leaving scenario only — no "on leave" language anywhere
- [ ] Onboarding kit pre-filled with Priya Sharma on page load
- [ ] Name input + Generate button visible at top of onboarding page
- [ ] All four sections of onboarding kit visible on scroll
- [ ] No API calls — all data hardcoded in the component
- [ ] "What's NOT included" card present in Export tab
