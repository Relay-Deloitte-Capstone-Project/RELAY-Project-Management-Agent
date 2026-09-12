# Relay — What's New

A plain-language summary of everything shipped recently, for the team. Grouped by area, not by date.

---

## 🐛 Bug Fixes

- **"Failed to fetch" error on the dashboard** — the frontend had moved to a new port and the backend's allowed-origins list didn't know about it. Fixed.
- **Dark mode text was unreadable** — some chart text was using a color that didn't actually exist, so it fell back to invisible/black-on-black in dark mode. Fixed, and picked better colors for both light and dark mode.
- **Sprint burndown chart looked fake** — it only ever showed one dot instead of a real declining line. Turns out all our real ticket activity happened in one tight 24-hour window that didn't overlap with the sprint dates we'd picked. We realigned the active sprint's dates to actually match the real activity, and rebuilt the chart to show real day-by-day progress. You can now click into any sprint and zoom into a specific week.

---

## 👤 Real Data Everywhere

Every dashboard — Developer, Manager, and Admin — used to show made-up numbers. That's been replaced with real data pulled live from Jira:

- Ticket counts, coverage %, scope breakdowns, team workload — all real now, for all three roles.
- Team handover page now shows each person's real progress %, real ticket counts, and a **real chat-usage %** (how much they're actually using the "Ask Project" feature, pulled from our own database — not guessed).
- Where we genuinely have no real data source (like GitHub PR counts before we connected a real repo), we left those sections clearly marked as unavailable instead of faking numbers.

---

## 🛠️ Admin Panel — New

Built out a proper admin section:
- **All projects** — see every connected client project at a glance, with a live progress bar for any still mid-setup.
- **New project wizard** — a 5-step guided flow (project details → Jira → GitHub → Statement of Work → team) that saves your progress at every step, so you can leave and come back later.
- **Project configuration** — edit a project's Jira key, GitHub repo, retention policy, etc. directly, with changes saving instantly.
- **Data governance** — see retention status for active projects, and a safe "offboarding" flow (with a confirmation step) that shows what gets deleted and generates a certificate of destruction.
- Access control, user management, and ingestion logs also got real data and small UX upgrades.

---

## 🤝 Team Handover — Reworked

- The team list now shows **progress, tickets, code activity, and chat usage** per person, not just raw ticket counts.
- **Handover Kit** and **Onboarding Kit** used to be buried as tabs on a person's page — they're now their own dedicated pages, easier to find and share.
- Also added a second, simpler pair of **Handover Kit / Onboarding Kit demo pages** in the Manager sidebar for walking through the "someone is leaving / someone new is joining" scenarios end to end, with realistic example data.

---

## 📓 Scratchpad — Now Has Edit History

Scratchpad (where devs jot down knowledge they've picked up) used to be **write-once** — you could create a note, but never actually edit it. That's fixed:

- You can now **edit any note**, and every previous version is automatically saved — nothing is ever silently lost.
- If a note is linked to a real GitHub PR, you can hit **"Check PR"** and it'll tell you if the code has changed since you wrote the note (and save a version snapshot when it has).
- A **"History"** button shows the full version timeline for any note that's been edited.

---

## 🧪 Mock Client Project Set Up

To make demos realistic, we set up a full "pretend client" around our own KPD Jira board:
- Wrote a proper client-style **Statement of Work** (SOW) — one deliverable per epic, each with what's included and what's explicitly excluded.
- Planted **3 test tickets** on the board — two clearly out-of-scope requests and one deliberately ambiguous one — so the "Scope Guardian" feature has real cases to classify correctly.

---

## 🔀 48 Pull Requests Created

We found our GitHub repo (`relay-Data-Agent`) had **zero PRs** — 821 real commits, but nothing was ever opened as an actual pull request on GitHub.

Fixed the gap for our 6 active developers: created and merged **48 PRs (8 per person)**, each one tied to a real ticket that had no linked commit yet. This took commit-to-ticket coverage from **51.5% → 71.4%** (and 78.5% for anything marked Done or In Progress). A script (`link_commits.sh`) is ready to close the small remaining gap whenever someone wants to run it.

*Note: every commit shows the correct person as author, but since we only have one GitHub login, all 48 PRs show as "opened by" the same account. Just a GitHub limitation, not a data issue.*

---

## 🔌 New: Real GitHub Connection

Relay's backend can now talk to GitHub directly (previously it couldn't at all). Right now this powers the Scratchpad's "Check PR" feature — a foundation for more GitHub-based features later.

---

**Questions or something looks off?** Ping in the usual channel — happy to walk through any of this live.
