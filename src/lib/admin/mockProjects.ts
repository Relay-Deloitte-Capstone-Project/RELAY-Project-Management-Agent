export type ProjectStatus = "active" | "setup" | "archived";

export type SetupStepKey = "details" | "jira" | "github" | "sow" | "team";

export type SetupProgress = Record<SetupStepKey, boolean>;

export type ProjectTeamMember = { initials: string; name: string; role: string };

export type MockProject = {
  id: string;
  name: string;
  clientName: string;
  jiraKey: string;
  jiraBaseUrl: string;
  githubRepo: string;
  status: ProjectStatus;
  memberCount: number;
  startDate: string;
  retentionDays: number | null;
  dpaReference: string;
  contractEnd: string | null;
  setupProgress: SetupProgress;
  lastActivity: string;
  capstone?: boolean;
  ticketCount: number;
  commitCount: number;
  coveragePct: number;
  chunksCount: number;
  lastSync: string;
  team: ProjectTeamMember[];
};

export const SETUP_STEPS: SetupStepKey[] = ["details", "jira", "github", "sow", "team"];

export function completedStepCount(progress: SetupProgress) {
  return SETUP_STEPS.filter((s) => progress[s]).length;
}

export function firstIncompleteStep(progress: SetupProgress) {
  const idx = SETUP_STEPS.findIndex((s) => !progress[s]);
  return idx === -1 ? SETUP_STEPS.length - 1 : idx;
}

export const mockProjects: MockProject[] = [
  {
    id: "kafka",
    name: "Apache Kafka",
    clientName: "Apache Software Foundation",
    jiraKey: "KAN",
    jiraBaseUrl: "issues.apache.org",
    githubRepo: "apache/kafka",
    status: "active",
    memberCount: 6,
    startDate: "2026-01-12",
    retentionDays: 30,
    dpaReference: "DPA-2026-001",
    contractEnd: "2026-09-16",
    setupProgress: { details: true, jira: true, github: true, sow: true, team: true },
    lastActivity: "2h ago",
    ticketCount: 1247,
    commitCount: 892,
    coveragePct: 62,
    chunksCount: 8420,
    lastSync: "2 minutes ago",
    team: [
      { initials: "AG", name: "Anya Gupta", role: "Manager" },
      { initials: "AK", name: "Akshar Kher", role: "Developer" },
      { initials: "RG", name: "Ravi Gupta", role: "Developer" },
      { initials: "AB", name: "Adveita", role: "Developer" },
      { initials: "PS", name: "Priya Sharma", role: "Developer" },
      { initials: "OH", name: "Omar Hassan", role: "Developer" },
    ],
  },
  {
    id: "relay-internal",
    name: "Relay — Project Memory",
    clientName: "Deloitte USI Capstone 2026",
    jiraKey: "KPD",
    jiraBaseUrl: "relay.atlassian.net",
    githubRepo: "Anya-Gupta-05/idea-explainer-pro",
    status: "active",
    memberCount: 3,
    startDate: "2026-09-03",
    retentionDays: null,
    dpaReference: "—",
    contractEnd: null,
    setupProgress: { details: true, jira: true, github: true, sow: true, team: true },
    lastActivity: "13h ago",
    capstone: true,
    ticketCount: 24,
    commitCount: 47,
    coveragePct: 58,
    chunksCount: 612,
    lastSync: "12 minutes ago",
    team: [
      { initials: "AG", name: "Anya Gupta", role: "Manager" },
      { initials: "AK", name: "Akshar Kher", role: "Developer" },
      { initials: "RG", name: "Ravi Gupta", role: "Developer" },
    ],
  },
  {
    id: "acme",
    name: "Acme Data Migration",
    clientName: "Acme Corp",
    jiraKey: "ACM",
    jiraBaseUrl: "acmecorp.atlassian.net",
    githubRepo: "acme-corp/data-migration",
    status: "setup",
    memberCount: 1,
    startDate: "2026-09-08",
    retentionDays: 30,
    dpaReference: "DPA-2026-014",
    contractEnd: "2027-01-15",
    setupProgress: { details: true, jira: true, github: false, sow: false, team: false },
    lastActivity: "37m ago",
    ticketCount: 0,
    commitCount: 0,
    coveragePct: 0,
    chunksCount: 0,
    lastSync: "—",
    team: [{ initials: "AG", name: "Anya Gupta", role: "Manager" }],
  },
];

export function addMockProject(project: MockProject) {
  mockProjects.unshift(project);
}

export function getMockProject(id: string) {
  return mockProjects.find((p) => p.id === id) ?? null;
}

export function updateMockProject(id: string, patch: Partial<MockProject>) {
  const project = mockProjects.find((p) => p.id === id);
  if (project) Object.assign(project, patch);
  return project ?? null;
}

export function activateMockProject(id: string) {
  const project = mockProjects.find((p) => p.id === id);
  if (project) project.status = "active";
}

export function archiveMockProject(id: string) {
  const project = mockProjects.find((p) => p.id === id);
  if (project) project.status = "archived";
}

export type Certificate = {
  id: string;
  projectName: string;
  destroyedAt: string;
  chunksDeleted: number;
  certifiedBy: string;
};

export const mockCertificates: Certificate[] = [
  {
    id: "cert-1",
    projectName: "Client X — Q2 engagement",
    destroyedAt: "2026-07-31",
    chunksDeleted: 4821,
    certifiedBy: "Anya Gupta",
  },
];

export function addMockCertificate(cert: Certificate) {
  mockCertificates.unshift(cert);
}

export type IngestionLogLevel = "info" | "warn" | "error";
export type IngestionLogEntry = {
  id: string;
  projectId: string;
  timestamp: string;
  source: "JIRA" | "GITHUB" | "GITLEAKS" | "EMBED";
  message: string;
  level: IngestionLogLevel;
};

export const mockIngestionLogs: IngestionLogEntry[] = [
  {
    id: "l1",
    projectId: "kafka",
    timestamp: "14:22:01",
    source: "JIRA",
    message: "Jira sync complete — 12 new, 3 updated",
    level: "info",
  },
  {
    id: "l2",
    projectId: "kafka",
    timestamp: "14:22:08",
    source: "GITHUB",
    message: "4 new commits, 1 PR merged",
    level: "info",
  },
  {
    id: "l3",
    projectId: "kafka",
    timestamp: "14:22:14",
    source: "GITLEAKS",
    message: "Secrets scan — 0 new findings",
    level: "info",
  },
  {
    id: "l4",
    projectId: "kafka",
    timestamp: "14:22:18",
    source: "EMBED",
    message: "42 chunks embedded, 8 skipped (secrets)",
    level: "warn",
  },
  {
    id: "l5",
    projectId: "kafka",
    timestamp: "09:15:03",
    source: "JIRA",
    message: "Rate limit — retried after 60s",
    level: "warn",
  },
  {
    id: "l6",
    projectId: "kafka",
    timestamp: "08:58:41",
    source: "GITHUB",
    message: "Webhook delivery failed — retrying",
    level: "error",
  },
  {
    id: "l7",
    projectId: "relay-internal",
    timestamp: "13:40:12",
    source: "JIRA",
    message: "Jira sync complete — 3 new, 1 updated",
    level: "info",
  },
  {
    id: "l8",
    projectId: "relay-internal",
    timestamp: "13:40:20",
    source: "EMBED",
    message: "9 chunks embedded",
    level: "info",
  },
  {
    id: "l9",
    projectId: "acme",
    timestamp: "11:02:55",
    source: "JIRA",
    message: "Initial sync started",
    level: "info",
  },
];
