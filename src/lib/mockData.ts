export const project = {
  name: "Apache Kafka",
  engagement: "Q3 engagement",
  tickets: 1247,
  commits: 892,
  prThreads: 344,
};

export const tickets = [
  {
    key: "KAFKA-16245",
    summary: "Consumer group rebalance timeout on large clusters",
    status: "In progress",
    priority: "High",
    type: "Bug",
    assignee: "Agrim_Gairola",
    staleDays: 0,
  },
  {
    key: "KAFKA-16180",
    summary: "Fix SASL auth token refresh loop",
    status: "Open",
    priority: "Critical",
    type: "Bug",
    assignee: "Agrim_Gairola",
    staleDays: 5,
  },
  {
    key: "KAFKA-16092",
    summary: "Add metrics for partition reassignment",
    status: "In review",
    priority: "Medium",
    type: "Task",
    assignee: "Agrim_Gairola",
    staleDays: 0,
  },
];

export const unlinkedTickets = [
  {
    key: "KAFKA-15904",
    summary: "Flaky test in ReplicaFetcherThreadTest",
    status: "Open",
    type: "Test",
  },
  {
    key: "KAFKA-15877",
    summary: "Document tiered storage retention semantics",
    status: "In progress",
    type: "Docs",
  },
  {
    key: "KAFKA-15790",
    summary: "Broker shutdown hangs on unclean log dir",
    status: "Open",
    type: "Bug",
  },
  {
    key: "KAFKA-15612",
    summary: "Improve error message for invalid ACL bindings",
    status: "Blocked",
    type: "Improvement",
  },
  {
    key: "KAFKA-15488",
    summary: "Reduce controller memory on 10k-partition clusters",
    status: "Open",
    type: "Improvement",
  },
];

export const branches = [
  { name: "fix/kafka-16245-rebalance", commitsAhead: 3, lastPush: "2h ago" },
  { name: "fix/kafka-16180-auth", commitsAhead: 1, lastPush: "3d ago" },
];

export const teamMembers = [
  {
    id: "agrim",
    name: "Agrim_Gairola",
    initials: "AG",
    role: "Backend developer",
    lastCommit: "24d ago",
    tickets: 7,
    prs: 3,
    reviews: 2,
    onLeave: true,
    tone: "brand" as const,
  },
  {
    id: "shubhr",
    name: "Shubhr Aryan",
    initials: "SA",
    role: "Core systems",
    lastCommit: "6h ago",
    tickets: 4,
    prs: 1,
    reviews: 0,
    onLeave: false,
    tone: "success" as const,
  },
  {
    id: "jason",
    name: "Jason Maro",
    initials: "JM",
    role: "Consumer team",
    lastCommit: "1d ago",
    tickets: 5,
    prs: 2,
    reviews: 1,
    onLeave: false,
    tone: "warning" as const,
  },
  {
    id: "priya",
    name: "Priya Kumar",
    initials: "PK",
    role: "Storage",
    lastCommit: "5d ago",
    tickets: 3,
    prs: 1,
    reviews: 0,
    onLeave: false,
    tone: "violet" as const,
  },
];

export type HandoverSituation = "leave" | "leaving" | "onboarding";

export const handoverDetails: Record<
  string,
  {
    activeSince: string;
    tickets: {
      key: string;
      title: string;
      priority: "Critical" | "High" | "Review" | "Low";
      note: string;
    }[];
    branches: {
      name: string;
      commitsAhead: number;
      lastPush: string;
      state: "mid-flight" | "stale";
    }[];
    prsAwaiting: { key: string; title: string; waitingDays: number }[];
    recentActivity: { sha: string; message: string; when: string }[];
    knowledgeRisks: { level: "high" | "medium" | "low"; title: string; detail: string }[];
    docCoverage: { label: string; value: number }[];
    recommendations: string[];
  }
> = {
  agrim: {
    activeSince: "Jan 2025",
    tickets: [
      {
        key: "KAFKA-16180",
        title: "SASL auth token refresh loop",
        priority: "Critical",
        note: "Blocked · No assignee coverage · last updated 5d ago",
      },
      {
        key: "KAFKA-16245",
        title: "Consumer group rebalance timeout",
        priority: "High",
        note: "In progress · branch fix/kafka-16245-rebalance · 3 commits",
      },
      {
        key: "KAFKA-16092",
        title: "Add metrics for partition reassignment",
        priority: "Review",
        note: "In progress · No description · No comments",
      },
      {
        key: "KAFKA-15990",
        title: "Update consumer offset manager docs",
        priority: "Low",
        note: "To do · not started",
      },
      {
        key: "KAFKA-16410",
        title: "Document tiered storage retention semantics",
        priority: "Low",
        note: "To do · not started",
      },
      {
        key: "KAFKA-16422",
        title: "Reduce controller memory on 10k-partition clusters",
        priority: "Review",
        note: "To do · not started",
      },
      {
        key: "KAFKA-16437",
        title: "Add rack-awareness to partition assignor",
        priority: "High",
        note: "To do · not started",
      },
    ],
    branches: [
      { name: "fix/kafka-16245", commitsAhead: 3, lastPush: "2h ago", state: "mid-flight" },
      { name: "fix/kafka-16180", commitsAhead: 1, lastPush: "3d ago", state: "stale" },
      {
        name: "fix/kafka-16092-partition-metrics",
        commitsAhead: 2,
        lastPush: "6d ago",
        state: "stale",
      },
    ],
    prsAwaiting: [
      { key: "#16789", title: "Add grace window to SASL token rotation", waitingDays: 2 },
      { key: "#16825", title: "Partition reassignment throttle config", waitingDays: 1 },
    ],
    recentActivity: [
      {
        sha: "a3f2b1c",
        message: "Fixed token rotation window overlap in SASL handler",
        when: "2h ago",
      },
      {
        sha: "8e4d9f1",
        message: "WIP: rebalance timeout — partial implementation",
        when: "3d ago",
      },
      {
        sha: "c7a1e2f",
        message: "PR review comment: suggested using atomic compare-and-swap",
        when: "4d ago",
      },
    ],
    knowledgeRisks: [
      {
        level: "high",
        title: "SASL auth module — Agrim is the sole contributor to 87% of commits",
        detail:
          "No other team member has touched this module in the last 6 months. If his branch doesn't merge, this is unrecoverable context.",
      },
      {
        level: "medium",
        title: "Consumer rebalance fix — only 1 PR review comment thread explaining the approach",
        detail:
          "Agrim responded to a question in PR #16789 but the reasoning was not captured in a scratchpad note.",
      },
      {
        level: "low",
        title:
          "Partition metrics endpoint — well documented, 3 linked commits, PR description is thorough",
        detail: "Safe to hand over. KAFKA-16092 has enough context for any developer to continue.",
      },
    ],
    docCoverage: [
      { label: "SASL / auth module", value: 12 },
      { label: "Consumer group rebalance", value: 38 },
      { label: "Partition metrics", value: 74 },
    ],
    recommendations: [
      "Ask Agrim to approve the auto-draft note from PR #16801 (currently pending in his scratchpad)",
      "Schedule a 30-min knowledge transfer for the SASL module with whoever takes over",
      "The unmerged fix/kafka-16180 branch needs a decision: merge as-is or close with a note",
      "Anya commented on KAFKA-16092 on 2026-08-12 asking someone to pick up this ticket — no reply yet",
    ],
  },
  shubhr: {
    activeSince: "Jan 2023",
    tickets: [
      {
        key: "KAFKA-16301",
        title: "Add custom dashboard for partition health",
        priority: "High",
        note: "Open · 1 day stale",
      },
      {
        key: "KAFKA-16112",
        title: "KRaft controller failover latency regression",
        priority: "Review",
        note: "In review · today",
      },
    ],
    branches: [
      {
        name: "feat/kraft-failover-latency",
        commitsAhead: 6,
        lastPush: "6h ago",
        state: "mid-flight",
      },
    ],
    prsAwaiting: [{ key: "#16801", title: "Agrim's PR awaiting review", waitingDays: 0 }],
    recentActivity: [
      { sha: "f0a91cd", message: "Reworked controller failover retry backoff", when: "6h ago" },
      {
        sha: "2b6d8e3",
        message: "Added dashboard scaffolding for partition health",
        when: "1d ago",
      },
    ],
    knowledgeRisks: [
      {
        level: "medium",
        title: "KRaft failover module — Shubhr is sole reviewer on 6 of the last 8 PRs",
        detail:
          "Failover logic is well-commented in code but the retry-backoff rationale lives only in PR discussion.",
      },
      {
        level: "low",
        title: "Partition health dashboard — early stage, low risk if paused",
        detail: "Scaffolding only; no downstream dependents yet.",
      },
    ],
    docCoverage: [
      { label: "KRaft failover", value: 58 },
      { label: "Partition health dashboard", value: 20 },
    ],
    recommendations: [
      "Capture the retry-backoff rationale from PR #16801 discussion into a scratchpad note",
      "Confirm someone else can review Agrim's pending PR while Shubhr is out",
    ],
  },
  jason: {
    activeSince: "Jun 2022",
    tickets: [
      {
        key: "KAFKA-16289",
        title: "Extend health check to include rack awareness",
        priority: "High",
        note: "Open · 3 days stale",
      },
      {
        key: "KAFKA-16204",
        title: "Consumer group protocol v2 assignor edge cases",
        priority: "Review",
        note: "In progress · 2 days",
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
    prsAwaiting: [{ key: "#16744", title: "Rack-aware health check probes", waitingDays: 3 }],
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
    ],
    knowledgeRisks: [
      {
        level: "high",
        title: "Consumer protocol v2 assignor — Jason is the only contributor",
        detail:
          "Edge-case handling for uneven partition counts is undocumented and only exists in the branch diff.",
      },
    ],
    docCoverage: [{ label: "Consumer protocol v2 assignor", value: 15 }],
    recommendations: [
      "Ask Jason to walk through the assignor edge cases with another developer for redundancy",
      "Assign a reviewer to #16744 — it's been waiting 3 days",
    ],
  },
  priya: {
    activeSince: "Sep 2021",
    tickets: [
      {
        key: "KAFKA-15790",
        title: "Broker shutdown hangs on unclean log dir",
        priority: "High",
        note: "Open · 6 days stale",
      },
    ],
    branches: [
      { name: "fix/tiered-storage-retention", commitsAhead: 2, lastPush: "5d ago", state: "stale" },
    ],
    prsAwaiting: [],
    recentActivity: [
      { sha: "1a2b3c4", message: "Investigated shutdown hang on unclean log dir", when: "5d ago" },
    ],
    knowledgeRisks: [
      {
        level: "medium",
        title: "Tiered storage retention — branch stale for 5 days, no PR opened yet",
        detail:
          "Priya is the only one who has touched tiered storage retention semantics in the last 3 months.",
      },
    ],
    docCoverage: [{ label: "Tiered storage retention", value: 45 }],
    recommendations: [
      "Decide whether the stale fix/tiered-storage-retention branch should be picked up or closed",
    ],
  },
};

export const epics = [
  {
    key: "kraft-consensus",
    title: "KRaft consensus protocol",
    deliverable: "D1",
    status: "On track",
    scopeAlignment: 100,
    docCoverage: 72,
    codeCoverage: 45,
    docs: 5,
    prs: 14,
  },
  {
    key: "consumer-protocol",
    title: "Consumer group protocol v2",
    deliverable: "D2",
    status: "At risk",
    scopeAlignment: 89,
    docCoverage: 28,
    codeCoverage: 81,
    docs: 2,
    prs: 23,
  },
];

export const scratchpadNotes = [
  {
    id: 1,
    title: "Consumer rebalance timeout fix",
    body: "OAuth token refresh was looping because the rotation window had no overlap. The fix adds a 30-second grace period where both old and new tokens are valid during the handoff. Without the overlap, a broker that fetched the new token before the coordinator finished rotating would retry indefinitely.",
    source: "PR #16801",
    draftedAt: "2 hours ago",
    approved: false,
  },
  {
    id: 2,
    title: "KRaft leader election edge case",
    body: "When the active controller fails mid-write, the new leader must replay the uncommitted log tail. Key insight: the epoch number must increment BEFORE the replay, not after — otherwise followers reject the replayed entries as stale.",
    source: "PR #16650",
    approvedAt: "Aug 25",
    approved: true,
  },
  {
    id: 3,
    title: "Partition reassignment gotcha",
    body: "Reassignment throttle only applies to inter-broker traffic. Intra-broker moves (same machine, different log dir) are unthrottled and can saturate disk I/O. Always check log.dirs config before triggering.",
    source: "manual",
    approvedAt: "Aug 20",
    approved: true,
  },
];

export const conversation = [
  {
    role: "user" as const,
    text: "Why did we switch from Zookeeper to KRaft?",
  },
  {
    role: "assistant" as const,
    text: "The migration from Zookeeper to KRaft was driven by eliminating the external dependency on Zookeeper for metadata management. Key reasons: simplified operations, improved scalability for large clusters, and faster controller failover.",
    citations: [
      {
        key: "KAFKA-13360",
        snippet:
          "Metadata now lives in an internal Raft quorum. Removing the Zookeeper dependency cuts one operational system from every deployment and removes the dual-write consistency problem during controller failover.",
      },
      {
        key: "PR #12762",
        snippet:
          "Controller failover measured at 1.8s p99 on a 9-broker cluster with 12k partitions, down from 28s with the Zookeeper-based controller.",
      },
      {
        key: "KAFKA-14762",
        snippet:
          "Migration path documented: brokers run in dual-write mode, then metadata ownership is handed to the KRaft quorum before Zookeeper is decommissioned.",
      },
    ],
    tier: "Gemini · 3 sources · 1.2s",
  },
  {
    role: "user" as const,
    text: "What testing framework do we use for integration tests?",
  },
  { role: "abstain" as const },
];

export const scopeDeliverables = [
  {
    key: "D1",
    title: "KRaft consensus migration",
    tickets: 12,
    compliance: 100,
    status: "On track",
  },
  {
    key: "D2",
    title: "Consumer group protocol v2",
    tickets: 18,
    compliance: 89,
    status: "At risk",
  },
  {
    key: "D3",
    title: "Observability and metrics",
    tickets: 8,
    compliance: 62,
    status: "Scope creep",
  },
];

export const permissions = [
  {
    user: "Priya Menon",
    role: "Developer",
    jira: true,
    github: true,
    lastSync: "2 min ago",
  },
  {
    user: "Agrim_Gairola",
    role: "Developer",
    jira: true,
    github: false,
    lastSync: "8 min ago",
  },
  { user: "Ananya Iyer", role: "PM", jira: true, github: true, lastSync: "2 min ago" },
];

export const secretFindings = [
  {
    detector: "AWS access key",
    file: "config/test.properties",
    sha: "a3f2b1c",
    found: "Aug 12 2024",
  },
  {
    detector: "Generic API key",
    file: "scripts/deploy.sh",
    sha: "8e4d9f1",
    found: "Mar 5 2023",
  },
  {
    detector: "Private key block",
    file: "tests/fixtures/broker.pem",
    sha: "c71a409",
    found: "Nov 2 2022",
  },
  {
    detector: "Slack webhook",
    file: ".github/workflows/notify.yml",
    sha: "5b0e33d",
    found: "Jun 19 2025",
  },
];

export const ingestionRuns = [
  {
    source: "Jira tickets",
    records: "1,247",
    duration: "4m 32s",
    status: "Complete",
    lastRun: "2h ago",
  },
  {
    source: "GitHub commits",
    records: "892",
    duration: "2m 18s",
    status: "Complete",
    lastRun: "2h ago",
  },
  {
    source: "PR threads",
    records: "344",
    duration: "1m 05s",
    status: "Complete",
    lastRun: "2h ago",
  },
  {
    source: "SOW clauses",
    records: "68",
    duration: "0m 14s",
    status: "Complete",
    lastRun: "2h ago",
  },
];

export const scopeHealth = [
  { label: "In-scope tickets", value: 78, tone: "success" as const },
  { label: "Out-of-scope", value: 12, tone: "danger" as const },
  { label: "Ambiguous", value: 10, tone: "warning" as const },
];

export const riskSignals = [
  {
    level: "high" as const,
    title: "3 tickets flagged out-of-scope",
    detail: "Custom dashboards and alerting work outside the D3 metrics boundary.",
  },
  {
    level: "medium" as const,
    title: "Epic 'Consumer protocol' is 81% built but only 28% documented",
    detail: "Risk of knowledge loss if the assignee rotates off the project.",
  },
  {
    level: "low" as const,
    title: "Coverage improved 4% this week (58% → 62%)",
    detail: "Driven by 9 newly linked commits on the KRaft migration epic.",
  },
];

export const weeklyActivity = [
  { label: "Tickets closed", value: 12 },
  { label: "PRs merged", value: 8 },
  { label: "Questions asked", value: 23 },
  { label: "Notes captured", value: 5 },
];

export const scopeAlerts = [
  {
    id: "kafka-16301",
    severity: "danger" as const,
    badge: "Out of scope",
    key: "KAFKA-16301",
    title: "Add custom dashboard for partition health",
    detail: 'Violates D3 boundary: "Metrics limited to existing JMX endpoints." — Clause D3.4',
    action: "Draft change order",
  },
  {
    id: "kafka-16289",
    severity: "warning" as const,
    badge: "Ambiguous",
    key: "KAFKA-16289",
    title: "Extend health check to include rack awareness",
    detail:
      "Could fall under D3 'system health monitoring' but rack awareness is not explicitly listed. Escalated to PM.",
    action: null,
  },
];

export const systemServices = [
  { label: "Database", value: "Connected", tone: "success" as const },
  { label: "Jira MCP", value: "Connected", tone: "success" as const },
  { label: "GitHub MCP", value: "Connected", tone: "success" as const },
  { label: "Ollama", value: "llama3.1:8b", tone: "success" as const },
];

export const allUsers = [
  {
    name: "Agrim_Gairola",
    initials: "AG",
    email: "agrim@relay.dev",
    role: "Developer",
    projects: 1,
    status: "On leave",
    lastSeen: "6d ago",
  },
  {
    name: "Ananya Iyer",
    initials: "AI",
    email: "ananya.iyer@relay.dev",
    role: "PM",
    projects: 3,
    status: "Active",
    lastSeen: "20m ago",
  },
  {
    name: "Jason Maro",
    initials: "JM",
    email: "jason@relay.dev",
    role: "Developer",
    projects: 1,
    status: "Active",
    lastSeen: "1d ago",
  },
  {
    name: "Meera Nair",
    initials: "MN",
    email: "meera.nair@relay.dev",
    role: "Admin",
    projects: 4,
    status: "Active",
    lastSeen: "5m ago",
  },
];
