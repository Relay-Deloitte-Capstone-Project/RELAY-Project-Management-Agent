export type LeavingPersonId = "ravi" | "jason" | "david";

export type CriticalTicket = {
  key: string;
  summary: string;
  status: string;
  priority: "Critical" | "High" | "Medium" | "Low";
  daysSinceUpdate: number;
};

export type UnmergedBranch = {
  name: string;
  commitsAhead: number;
  lastPush: string;
  state: "mid-flight" | "stale";
};

export type ActivityCommit = { sha: string; message: string; when: string };

export type KnowledgeRisk = { level: "high" | "medium" | "low"; title: string; detail: string };

export type DocCoverageBar = { label: string; value: number };

export type LeavingPerson = {
  id: LeavingPersonId;
  name: string;
  leavingDate: string;
  metrics: { openTickets: number; openPrs: number; unmergedBranches: number };
  criticalTickets: CriticalTicket[];
  branches: UnmergedBranch[];
  recentActivity: ActivityCommit[];
  knowledgeRisks: KnowledgeRisk[];
  docCoverage: DocCoverageBar[];
  recommendations: string[];
  prefillAssignee: Record<string, string>;
  prefillUrgency: Record<string, "Critical" | "High" | "Medium">;
};

export const TEAM_MEMBER_OPTIONS = ["Jun Rao", "Jason Gustafson", "David Arthur", "Priya Sharma"];

export const LEAVING_PEOPLE: LeavingPerson[] = [
  {
    id: "ravi",
    name: "Ravi Gupta",
    leavingDate: "Sep 16, 2026",
    metrics: { openTickets: 7, openPrs: 3, unmergedBranches: 2 },
    criticalTickets: [
      {
        key: "KAFKA-16180",
        summary: "SASL auth token refresh loop",
        status: "Open",
        priority: "Critical",
        daysSinceUpdate: 5,
      },
      {
        key: "KAFKA-16245",
        summary: "Consumer group rebalance timeout",
        status: "In progress",
        priority: "High",
        daysSinceUpdate: 0,
      },
      {
        key: "KAFKA-16092",
        summary: "Add metrics for partition reassignment",
        status: "In review",
        priority: "Medium",
        daysSinceUpdate: 0,
      },
      {
        key: "KAFKA-15990",
        summary: "Update consumer offset manager docs",
        status: "Open",
        priority: "Low",
        daysSinceUpdate: 12,
      },
    ],
    branches: [
      {
        name: "fix/kafka-16245-rebalance",
        commitsAhead: 3,
        lastPush: "2h ago",
        state: "mid-flight",
      },
      { name: "fix/kafka-16180-auth", commitsAhead: 1, lastPush: "3d ago", state: "stale" },
    ],
    recentActivity: [
      {
        sha: "a3f2b1c",
        message: "Fix token rotation window overlap in SASL handler",
        when: "2h ago",
      },
      {
        sha: "8e4d9f1",
        message: "WIP: rebalance timeout — partial implementation",
        when: "3d ago",
      },
      { sha: "c7a1e2f", message: "PR review: suggested atomic compare-and-swap", when: "4d ago" },
      { sha: "b2d9e11", message: "Add unit test for offset commit flow", when: "5d ago" },
      { sha: "f4a8c23", message: "Refactor SASL handshake retry logic", when: "6d ago" },
    ],
    knowledgeRisks: [
      {
        level: "high",
        title: "SASL auth module — Ravi authored 87% of commits in the last 6 months",
        detail:
          "No other team member has touched this module. If the unmerged branch isn't transferred, the context is lost permanently.",
      },
      {
        level: "medium",
        title: "Consumer rebalance fix — only one PR review thread explains the approach",
        detail:
          "Ravi answered Jun's question in PR #16789 but the reasoning was never captured in a scratchpad note.",
      },
      {
        level: "low",
        title: "Partition metrics endpoint — well documented, 3 linked commits",
        detail: "PR description is thorough. Safe to hand over without a knowledge transfer.",
      },
    ],
    docCoverage: [
      { label: "SASL / auth module", value: 12 },
      { label: "Consumer group rebalance", value: 38 },
      { label: "Partition metrics", value: 74 },
    ],
    recommendations: [
      "Ask Ravi to approve the auto-draft note from PR #16801 (currently pending in his scratchpad)",
      "Schedule a 30-min knowledge transfer for the SASL module with whoever takes over KAFKA-16180",
      "KAFKA-16180 branch needs a decision: merge as-is, assign new owner, or close with a detailed note",
    ],
    prefillAssignee: { "KAFKA-16245": "Jun Rao" },
    prefillUrgency: { "KAFKA-16245": "High" },
  },
  {
    id: "jason",
    name: "Jason Gustafson",
    leavingDate: "Sep 30, 2026",
    metrics: { openTickets: 5, openPrs: 2, unmergedBranches: 1 },
    criticalTickets: [
      {
        key: "KAFKA-15901",
        summary: "Rebalance timeout investigation",
        status: "In progress",
        priority: "High",
        daysSinceUpdate: 1,
      },
      {
        key: "KAFKA-15834",
        summary: "Consumer group coordinator NPE on restart",
        status: "Open",
        priority: "Medium",
        daysSinceUpdate: 4,
      },
      {
        key: "KAFKA-15790",
        summary: "Broker shutdown hangs on unclean log dir",
        status: "Open",
        priority: "Low",
        daysSinceUpdate: 8,
      },
    ],
    branches: [
      {
        name: "feat/consumer-protocol-v2-assignor",
        commitsAhead: 4,
        lastPush: "1d ago",
        state: "mid-flight",
      },
    ],
    recentActivity: [
      {
        sha: "9d1c4a2",
        message: "Added rack-awareness probe to health check loop",
        when: "1d ago",
      },
      {
        sha: "5e7f0b8",
        message: "WIP: assignor edge case for uneven partition counts",
        when: "2d ago",
      },
      { sha: "1f6a3d9", message: "Investigated coordinator NPE on broker restart", when: "4d ago" },
    ],
    knowledgeRisks: [
      {
        level: "medium",
        title: "Consumer protocol module — Jason authored 60% of commits",
        detail:
          "The assignor edge-case handling for uneven partition counts is undocumented outside the branch diff.",
      },
    ],
    docCoverage: [
      { label: "Consumer protocol module", value: 42 },
      { label: "Rebalance investigation notes", value: 55 },
    ],
    recommendations: [
      "Ask Jason to walk through the assignor edge cases with another developer for redundancy",
      "Decide who reviews the two open PRs before his last day",
    ],
    prefillAssignee: {},
    prefillUrgency: {},
  },
  {
    id: "david",
    name: "David Arthur",
    leavingDate: "Oct 10, 2026",
    metrics: { openTickets: 3, openPrs: 1, unmergedBranches: 0 },
    criticalTickets: [
      {
        key: "KAFKA-14210",
        summary: "Log compaction skips tombstones under load",
        status: "In review",
        priority: "High",
        daysSinceUpdate: 0,
      },
      {
        key: "KAFKA-14198",
        summary: "Retention policy misapplied on tiered storage",
        status: "Open",
        priority: "Medium",
        daysSinceUpdate: 6,
      },
    ],
    branches: [],
    recentActivity: [
      {
        sha: "7c2a1e0",
        message: "Fixed tombstone skip during compaction under load",
        when: "8h ago",
      },
      { sha: "e3b9f42", message: "Added regression test for retention policy", when: "2d ago" },
    ],
    knowledgeRisks: [
      {
        level: "low",
        title: "Storage engine — David authored 40% of commits",
        detail:
          "Log compaction and retention logic is documented; a second reviewer already covers most of it.",
      },
    ],
    docCoverage: [{ label: "Storage engine", value: 65 }],
    recommendations: [
      "Confirm a second reviewer for the open log-compaction PR before his last day",
    ],
    prefillAssignee: {},
    prefillUrgency: {},
  },
];

export const KIT_INCLUDED = [
  "Open ticket list with status and priority",
  "Open PRs and who is blocked waiting",
  "Unmerged branches with staleness",
  "Last 10 commits with messages",
  "Coverage gaps (modules only they have context for)",
  "Approved scratchpad notes",
  "Handover assignments (filled in Assign coverage)",
  "Manager's handover note",
];

export const KIT_EXCLUDED = [
  "Velocity or time-to-resolve metrics (personal data — DPDP §4)",
  "Performance comparison to other developers",
  "Effort predictions",
  "Any data from other client projects",
];
