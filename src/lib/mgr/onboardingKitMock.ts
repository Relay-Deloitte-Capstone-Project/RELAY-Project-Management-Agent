export const PROJECT_ORIENTATION = {
  title: "Apache Kafka — Q3 2026 Engagement",
  body: `This is a distributed streaming platform maintained by the Apache Software Foundation. The team is currently focused on three areas: the KRaft consensus protocol migration (replacing Zookeeper), consumer group protocol v2, and observability improvements.

The codebase is primarily Java. The main repo is apache/kafka on GitHub. Jira project key: KAN. Currently 1,247 tickets, 892 indexed commits.`,
};

export const ACTIVE_EPICS: { title: string; value: number; status: string; tickets: number }[] = [
  { title: "KRaft consensus migration", value: 86, status: "On track", tickets: 14 },
  { title: "Consumer group protocol v2", value: 43, status: "At risk", tickets: 18 },
  { title: "Observability + metrics", value: 28, status: "Stalled", tickets: 8 },
];

export const LANDMINES: { title: string; detail: string }[] = [
  {
    title: "KRaft leader election edge case",
    detail:
      "The epoch number must increment BEFORE the replay, not after — otherwise followers reject entries as stale. Ask Jun about this.",
  },
  {
    title: "Partition reassignment throttle",
    detail:
      "Only applies to inter-broker traffic. Intra-broker moves are unthrottled and can saturate disk I/O. Check log.dirs config first.",
  },
  {
    title: "SASL auth token refresh",
    detail:
      "The rotation window had no overlap — a 30-second grace period was added. See PR #16801 for the fix and reasoning.",
  },
];

export const OWNERSHIP: { area: string; owner: string; contact: string }[] = [
  { area: "SASL / auth module", owner: "Ravi Gupta", contact: "87% of commits — ask Ravi first" },
  { area: "Consumer protocol", owner: "Jun Rao", contact: "Main contributor to KRaft work" },
  { area: "Storage engine", owner: "David Arthur", contact: "All log compaction and retention" },
  { area: "Partition metrics", owner: "Jason Gustafson", contact: "Observability + JMX endpoints" },
];

export const REVIEW_OWNERSHIP: { area: string; reviewer: string; prCount: number }[] = [
  { area: "Backend / core changes", reviewer: "Jun Rao", prCount: 34 },
  { area: "Auth + security PRs", reviewer: "Ravi Gupta", prCount: 21 },
  { area: "Performance + storage", reviewer: "David Arthur", prCount: 18 },
];

export const ACTIVE_FILES: { path: string; commits: number }[] = [
  { path: "clients/src/main/java/org/apache/kafka/clients/consumer/", commits: 23 },
  { path: "core/src/main/scala/kafka/server/", commits: 18 },
  { path: "clients/src/main/java/org/apache/kafka/common/security/", commits: 14 },
  { path: "core/src/main/scala/kafka/coordinator/group/", commits: 11 },
  { path: "tests/kafkatest/", commits: 9 },
];

export const RECENT_FIXES: { key: string; summary: string; fixedIn: string }[] = [
  { key: "KAFKA-16180", summary: "SASL auth token refresh loop", fixedIn: "a3f2b1c" },
  {
    key: "KAFKA-16092",
    summary: "Partition reassignment metric was off by one",
    fixedIn: "8e4d9f1",
  },
  { key: "KAFKA-15834", summary: "Consumer group coordinator NPE on restart", fixedIn: "c7a1e2f" },
];

export const COVERAGE_MAP = {
  wellDocumented: [
    { label: "KRaft consensus", value: 72 },
    { label: "Partition metrics", value: 74 },
  ],
  darkAreas: [
    { label: "Consumer protocol", value: 38 },
    { label: "Observability", value: 28 },
    { label: "Auth module", value: 12 },
  ],
};

export const SUGGESTED_FIRST_TICKET = {
  key: "KAFKA-16092",
  title: "Add metrics for partition reassignment",
  reasons: [
    "Medium complexity — not trivial, not overwhelming",
    "Well documented — 3 linked commits, thorough PR description",
    "Not on the critical path — safe to take time to understand",
    "Jun Rao is familiar with it and available to answer questions",
  ],
  status: "In review",
  priority: "Medium",
  epic: "Observability",
};

export const KEY_PRS: { key: string; title: string; comments: number; note: string }[] = [
  {
    key: "#16789",
    title: "Token refresh edge case",
    comments: 14,
    note: "Jun + Ravi debating approach",
  },
  {
    key: "#16650",
    title: "KRaft leader election fix",
    comments: 11,
    note: "core architecture discussion",
  },
  {
    key: "#16340",
    title: "Consumer group v2 protocol",
    comments: 9,
    note: "design decision documented",
  },
  {
    key: "#15901",
    title: "Rebalance timeout investigation",
    comments: 8,
    note: "root cause analysis",
  },
  { key: "#15420", title: "SASL handshake retry", comments: 7, note: "security implications" },
];

export const MILESTONES: { day: string; label: string }[] = [
  { day: "Day 3", label: "First PR opened (even if small)" },
  { day: "Day 7", label: "First PR merged to main" },
  { day: "Day 14", label: "First feature ticket taken independently" },
  { day: "Day 30", label: "Autonomous contributor — no hand-holding needed" },
];
