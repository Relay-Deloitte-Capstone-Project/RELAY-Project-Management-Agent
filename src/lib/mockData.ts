export type Role = "developer" | "manager" | "admin";

export const project = {
  name: "Apache Kafka",
  engagement: "Q3 engagement",
  tickets: 1247,
  commits: 892,
  prThreads: 344,
};

export const currentUser = {
  name: "Ravi Gupta",
  firstName: "Ravi",
  initials: "RG",
  openTickets: 7,
  openPRs: 3,
  pendingReviews: 2,
};

export const tickets = [
  {
    key: "KAFKA-16245",
    summary: "Consumer group rebalance timeout on large clusters",
    status: "In progress",
    priority: "High",
    type: "Bug",
    assignee: "Ravi Gupta",
    staleDays: 0,
  },
  {
    key: "KAFKA-16180",
    summary: "Fix SASL auth token refresh loop",
    status: "Open",
    priority: "Critical",
    type: "Bug",
    assignee: "Ravi Gupta",
    staleDays: 5,
  },
  {
    key: "KAFKA-16092",
    summary: "Add metrics for partition reassignment",
    status: "In review",
    priority: "Medium",
    type: "Task",
    assignee: "Ravi Gupta",
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
    id: "ravi",
    name: "Ravi Gupta",
    initials: "RG",
    role: "Backend developer",
    lastCommit: "2h ago",
    tickets: 7,
    prs: 3,
    reviews: 2,
    onLeave: false,
    tone: "brand" as const,
  },
  {
    id: "jun",
    name: "Jun Rao",
    initials: "JR",
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
    name: "Jason Gustafson",
    initials: "JG",
    role: "Consumer team",
    lastCommit: "1d ago",
    tickets: 5,
    prs: 2,
    reviews: 1,
    onLeave: true,
    tone: "warning" as const,
  },
  {
    id: "david",
    name: "David Arthur",
    initials: "DA",
    role: "Storage",
    lastCommit: "5d ago",
    tickets: 3,
    prs: 1,
    reviews: 0,
    onLeave: false,
    tone: "violet" as const,
  },
];

export const handoverBriefs: Record<
  string,
  {
    tickets: { key: string; summary: string; status: string; stale: string }[];
    branches: { name: string; commitsAhead: number; lastPush: string }[];
    reviews: { key: string; summary: string; from: string; waiting: string }[];
  }
> = {
  ravi: {
    tickets: [
      {
        key: "KAFKA-16245",
        summary: "Consumer group rebalance timeout on large clusters",
        status: "In progress",
        stale: "today",
      },
      {
        key: "KAFKA-16180",
        summary: "Fix SASL auth token refresh loop",
        status: "Open",
        stale: "5 days stale",
      },
    ],
    branches: [
      { name: "fix/kafka-16245-rebalance", commitsAhead: 3, lastPush: "2h ago" },
      { name: "fix/kafka-16180-auth", commitsAhead: 1, lastPush: "3d ago" },
    ],
    reviews: [
      {
        key: "#16789",
        summary: "Add grace window to SASL token rotation",
        from: "Jun Rao",
        waiting: "2 days",
      },
    ],
  },
  jun: {
    tickets: [
      {
        key: "KAFKA-16301",
        summary: "Add custom dashboard for partition health",
        status: "Open",
        stale: "1 day",
      },
      {
        key: "KAFKA-16112",
        summary: "KRaft controller failover latency regression",
        status: "In review",
        stale: "today",
      },
    ],
    branches: [
      { name: "feat/kraft-failover-latency", commitsAhead: 6, lastPush: "6h ago" },
    ],
    reviews: [
      {
        key: "#16801",
        summary: "Consumer rebalance timeout fix",
        from: "Ravi Gupta",
        waiting: "4 hours",
      },
    ],
  },
  jason: {
    tickets: [
      {
        key: "KAFKA-16289",
        summary: "Extend health check to include rack awareness",
        status: "Open",
        stale: "3 days stale",
      },
      {
        key: "KAFKA-16204",
        summary: "Consumer group protocol v2 assignor edge cases",
        status: "In progress",
        stale: "2 days",
      },
    ],
    branches: [
      { name: "feat/consumer-protocol-v2-assignor", commitsAhead: 4, lastPush: "1d ago" },
    ],
    reviews: [
      {
        key: "#16744",
        summary: "Rack-aware health check probes",
        from: "David Arthur",
        waiting: "3 days",
      },
    ],
  },
  david: {
    tickets: [
      {
        key: "KAFKA-15790",
        summary: "Broker shutdown hangs on unclean log dir",
        status: "Open",
        stale: "6 days stale",
      },
    ],
    branches: [
      { name: "fix/tiered-storage-retention", commitsAhead: 2, lastPush: "5d ago" },
    ],
    reviews: [],
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
    user: "Ravi Gupta",
    role: "Developer",
    jira: true,
    github: false,
    lastSync: "8 min ago",
  },
  { user: "Jun Rao", role: "Developer", jira: true, github: true, lastSync: "2 min ago" },
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

export const allUsers = [
  {
    name: "Ravi Gupta",
    initials: "RG",
    email: "ravi.gupta@relay.dev",
    role: "Developer",
    projects: 1,
    status: "Active",
    lastSeen: "2h ago",
  },
  {
    name: "Jun Rao",
    initials: "JR",
    email: "jun.rao@relay.dev",
    role: "Developer",
    projects: 2,
    status: "Active",
    lastSeen: "6h ago",
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
    name: "Jason Gustafson",
    initials: "JG",
    email: "jason.g@relay.dev",
    role: "Developer",
    projects: 1,
    status: "On leave",
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
