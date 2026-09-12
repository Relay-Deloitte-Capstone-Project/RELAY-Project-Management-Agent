# TASK: All Projects page — complete overhaul
## Fix buttons, add real project data, build wizard modal, improve layout

---

## CURRENT STATE (from screenshot)

Three projects listed:
- Apache Kafka — Active, View button
- Project Relay — Active, View button  
- Acme Data Migration — Setup in progress, Continue setup button

Problems:
- View button does nothing
- Continue setup button does nothing
- Project Relay is wrongly labelled as "Internal" — it is our own capstone product
- Page looks empty below the project list
- No project details visible without clicking

---

## STEP 1 — Fix the project data (hardcoded, no backend change)

Replace the three project entries with correct dummy data:

```
Project 1: Apache Kafka
  Client:    Apache Software Foundation
  Jira key:  KAN
  GitHub:    github.com/apache/kafka
  Started:   12 Jan 2026
  Status:    Active (green dot)
  Stats:     1,247 tickets · 892 commits · 62% coverage
  Team:      6 members

Project 2: Relay — Project Memory
  Client:    Deloitte USI Capstone 2026
  Jira key:  KPD
  GitHub:    github.com/Anya-Gupta-05/idea-explainer-pro
  Started:   3 Sep 2026
  Status:    Active (green dot)
  Stats:     24 tickets · 47 commits · 58% coverage
  Team:      3 members
  Note: This is OUR product — label it "Capstone project" not "Internal"

Project 3: Acme Data Migration
  Client:    Acme Corp
  Jira key:  ACM
  GitHub:    github.com/acme-corp/data-migration (dummy)
  Started:   8 Sep 2026
  Status:    Setup in progress (blue dot)
  Progress:  2/5 steps complete (Details ✓, Jira ✓, GitHub ✗, SOW ✗, Team ✗)
```

---

## STEP 2 — Improve each project row layout

Each project row should show more information at rest. Expand from the current thin row to a richer card row.

**Active project row layout:**

```
● [Project name]                                [Active]  [View →]
  [Client] · [Jira key] · started [date]
  
  [Tickets: 1,247]  [Commits: 892]  [Coverage: 62%]  [Team: 6]
  
  Last sync: 2 minutes ago
```

The four mini stats are small chips: `background: var(--surface-1), border-radius: 6px, padding: 3px 8px, font-size: 10px`. Each has a muted label and a colored value.

"Last sync" is muted 10px text at the bottom right of the row.

Divider between each project row (0.5px border).

**Setup-in-progress row layout:**

```
● [Project name]                    [Setup in progress]  [Continue setup →]
  [Client] · [Jira key] · started [date]

  [────── Details ──────][──── Jira ────][  GitHub  ][  SOW  ][  Team  ]
  ✓ green filled          ✓ green filled   empty       empty    empty

  2 of 5 steps complete · last updated 37m ago
```

The progress bar stays but add step labels WITH check icons for completed steps.

---

## STEP 3 — Make "View →" button open a project detail panel

Clicking "View →" on any active project opens a **right-side slide panel** (not a new page, not a modal). The panel slides in from the right, 480px wide, overlays the page with a dim backdrop.

Panel header:
```
Apache Kafka                                    [×]
Apache Software Foundation · KAN
```

Panel body — three sections:

**Section 1: Connection status**
```
Jira        ● Connected    issues.apache.org · KAN    [Test]
GitHub      ● Connected    github.com/apache/kafka    [Test]
Last sync   2 minutes ago                             [Sync now]
```

**Section 2: Project stats**
Four stat cards in a 2×2 grid:
```
1,247 tickets    892 commits
62% coverage     8,420 chunks
```

**Section 3: Team members**
Small avatar + name list:
```
[AG] Anya Gupta     Manager
[AK] Akshar Kher    Developer
[RG] Ravi Gupta     Developer
[AB] Adveita        Developer
+ 2 more
```

Panel footer:
```
[Edit configuration]    [Begin offboarding]
```

Both buttons are ghost style. Clicking shows a toast: "This would open the configuration editor in production."

---

## STEP 4 — Make "Continue setup →" open the wizard modal

Clicking "Continue setup" on Acme Data Migration opens a **modal wizard** centered on screen. 640px wide. Steps shown at top as a progress row.

```
[✓ Details] → [✓ Jira] → [3 GitHub] → [4 SOW] → [5 Team]
```

Since steps 1 and 2 are already done, open the modal at **Step 3: GitHub**.

---

### Step 3 modal: Connect GitHub

```
Connect GitHub Repository
─────────────────────────────────────────────────
Repository URL
[https://github.com/acme-corp/data-migration    ]

Personal access token (read:repo scope only)
[●●●●●●●●●●●●●●●●●●●●●●●●          ] [Show]

Branch to track
[main                                           ]

                              [Test connection →]
```

On clicking "Test connection":
- Show a spinner for 1.5 seconds (use setTimeout)
- Then show a success state:
```
✓  acme-corp/data-migration — 234 commits found
```
- "Next →" button becomes enabled

---

### Step 4 modal: Upload SOW

```
Upload Scope of Work
─────────────────────────────────────────────────
[  📄  Drop PDF here or click to upload  ]
     or paste deliverables manually

Deliverables (we'll parse these from the PDF)
┌─────────────────────────────────┬──────────────┐
│ D1  Data extraction pipeline    │ edit ✕       │
│ D2  Transformation scripts      │ edit ✕       │
│ + Add deliverable               │              │
└─────────────────────────────────┴──────────────┘

Scope exclusions
[UI layer and frontend are explicitly out of scope]

Retention policy
  Retention period  [30    ] days after contract end
  DPA reference     [DPA-2026-002                  ]

                    [← Back]    [Save and continue →]
```

The file upload area is styled but does nothing on click (show toast: "File upload available in production"). The deliverables table is pre-filled with D1 and D2 as dummy rows. "+ Add deliverable" adds an empty editable row.

---

### Step 5 modal: Assign team

```
Assign Team Members
─────────────────────────────────────────────────
Search by name or email:
[                                   🔍           ]

Available:
  [RG] Ravi Gupta     ravi@relay.dev    [Developer ▾]  [Add →]
  [PS] Priya Sharma   priya@relay.dev   [Developer ▾]  [Add →]
  [OH] Omar Hassan    omar@relay.dev    [Developer ▾]  [Add →]

Already added:
  [AG] Anya Gupta     Manager           [Remove]

                    [← Back]    [Finish setup →]
```

Role dropdown options: Developer / Manager / Observer.

Clicking "Add →" moves the person from Available to Already added.
Clicking "Remove" moves them back.

Clicking "Finish setup →":
- Close the modal
- Change Acme Data Migration status from "Setup in progress" to "Active"
- Change its blue dot to green
- Show a toast: "Acme Data Migration is now active"

---

## STEP 5 — Make "+ New project" button open the wizard at Step 1

Clicking "+ New project" opens the same modal wizard but at Step 1.

### Step 1 modal: Project details

```
Create new project
─────────────────────────────────────────────────
Project name *
[                                               ]

Client name *
[                                               ]

Jira project key
[     ]  e.g. KAN

Start date                    Expected end date
[                ]            [                ]

Description (optional)
[                                               ]
[                                               ]

Retention policy
  [30] days after contract end

                              [Save and continue →]
```

Required fields: Project name, Client name. "Save and continue" disabled until both are filled.

### Step 2 modal: Connect Jira

```
Connect Jira
─────────────────────────────────────────────────
Jira base URL
[https://yourcompany.atlassian.net              ]

Project key
[KAN                                            ]

Email
[your@email.com                                 ]

API token
[●●●●●●●●●●●●●●●●●●●●●●●●          ] [Show]

                              [Test connection →]
```

"Test connection" → 1.5s spinner → success: "✓ Found [key] — [N] tickets"
Then Step 3, 4, 5 same as above.

---

## STEP 6 — KPD Workboard note

The "Relay — Project Memory" project row (our capstone) should show:
- Jira key: KPD
- A small note below the stats: "Syncing from KPD workboard · Jira Cloud Free"
- This is the only project row with this note

---

## STYLING NOTES

- Wizard modal: white background, 640px wide, border-radius 12px, centered with dim backdrop
- Modal header: project name + step title, close button top-right
- Progress steps row: completed = filled green circle with checkmark, current = filled blue, pending = grey circle with number
- Slide panel: fixed right side, 480px, full height, slide-in animation `translateX(100%) → translateX(0)` 0.25s ease
- Toast notifications: bottom-right, auto-dismiss after 3s
- All form inputs: 44px height, border, 8px radius, 13px font

---

## DONE WHEN

- [ ] Three project rows render with correct data (Kafka, Relay/KPD, Acme)
- [ ] Relay project shows "Capstone project" not "Internal" and shows KPD jira key
- [ ] Active project rows show 4 stat chips + last sync time
- [ ] "View →" opens a right slide panel with connection status + stats + team
- [ ] "Continue setup →" opens wizard modal at Step 3 (GitHub)
- [ ] "+ New project" opens wizard modal at Step 1 (Details)
- [ ] Test connection shows spinner then success state
- [ ] Step 4 SOW has pre-filled deliverables table
- [ ] Step 5 team assignment moves people between Available and Added
- [ ] "Finish setup" closes modal and marks Acme as Active
- [ ] KPD note visible on Relay project row
- [ ] All toast messages appear and auto-dismiss
- [ ] No broken buttons anywhere on the page
