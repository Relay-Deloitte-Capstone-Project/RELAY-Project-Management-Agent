// The handover-kit page (export-kit-final branch) looks up a recipient here
// by name before falling back to a slug it derives itself — that fallback
// already runs whenever no match is found, so an empty list changes nothing
// about its behavior. Left empty rather than guessing at a real team roster
// that branch never defined; fill in real entries if a lookup is intended.
export const teamMembers: { id: string; name: string }[] = [];

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
