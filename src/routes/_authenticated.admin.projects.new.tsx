import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, CircleAlert, Github, Loader2, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import { GhostButton, PageSection, Panel } from "@/components/relay/primitives";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  addMockProject,
  completedStepCount,
  firstIncompleteStep,
  getMockProject,
  updateMockProject,
  type MockProject,
  type SetupStepKey,
} from "@/lib/admin/mockProjects";
import { allUsers } from "@/lib/mockData";

export const Route = createFileRoute("/_authenticated/admin/projects/new")({
  validateSearch: (search: Record<string, unknown>): { project?: string } => {
    const project = search["project"];
    return typeof project === "string" ? { project } : {};
  },
  head: () => ({
    meta: [
      { title: "New project — Relay" },
      { name: "description", content: "5-step setup wizard for a new client engagement." },
      { property: "og:title", content: "New project — Relay" },
      {
        property: "og:description",
        content: "Connect Jira, GitHub, upload an SOW and assign a team.",
      },
    ],
  }),
  component: NewProjectWizard,
});

const STEPS = ["Project details", "Jira", "GitHub", "SOW", "Team"] as const;

type Deliverable = { id: string; name: string; criteria: string };
type TeamRole = "Developer" | "Manager" | "Observer";
type AddedMember = { name: string; email: string; role: TeamRole };
type ConnState = "idle" | "testing" | "success" | "error";

function StepProgress({ step }: { step: number }) {
  return (
    <div className="mb-6 flex items-center gap-1.5">
      {STEPS.map((label, i) => (
        <div key={label} className="flex flex-grow items-center gap-1.5">
          <div
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
              i < step
                ? "bg-success text-white"
                : i === step
                  ? "bg-brand text-brand-foreground"
                  : "bg-surface-sunken text-mute",
            )}
          >
            {i < step ? <Check className="size-3.5" /> : i + 1}
          </div>
          <span
            className={cn(
              "text-[12px] font-medium whitespace-nowrap",
              i === step ? "text-ink" : "text-mute",
            )}
          >
            {label}
          </span>
          {i < STEPS.length - 1 && <div className="mx-1 h-px flex-grow bg-border" />}
        </div>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="section-label">{label}</label>
      {children}
    </div>
  );
}

function WizardNav({
  step,
  canNext,
  onBack,
  onNext,
  nextLabel,
  extra,
}: {
  step: number;
  canNext: boolean;
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
      <GhostButton onClick={onBack} disabled={step === 0}>
        Back
      </GhostButton>
      <div className="flex items-center gap-3">
        {extra}
        <GhostButton tone="brand" onClick={onNext} disabled={!canNext}>
          {nextLabel ?? "Next"}
        </GhostButton>
      </div>
    </div>
  );
}

function NewProjectWizard() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const { project: resumeId } = Route.useSearch();
  const resuming = useMemo(() => (resumeId ? getMockProject(resumeId) : null), [resumeId]);
  const [step, setStep] = useState(() =>
    resuming ? firstIncompleteStep(resuming.setupProgress) : 0,
  );
  const [projectId, setProjectId] = useState<string | null>(resuming?.id ?? null);

  // Step 1
  const [projectName, setProjectName] = useState(resuming?.name ?? "");
  const [clientName, setClientName] = useState(resuming?.clientName ?? "");
  const [startDate, setStartDate] = useState(resuming?.startDate ?? "");
  const [endDate, setEndDate] = useState(resuming?.contractEnd ?? "");
  const [description, setDescription] = useState("");

  // Step 2
  const [jiraBaseUrl, setJiraBaseUrl] = useState(
    resuming?.setupProgress.jira ? "https://acmecorp.atlassian.net" : "",
  );
  const [jiraProjectKey, setJiraProjectKey] = useState(resuming?.jiraKey ?? "");
  const [jiraApiToken, setJiraApiToken] = useState(
    resuming?.setupProgress.jira ? "••••••••••••" : "",
  );
  const [jiraEmail, setJiraEmail] = useState(
    resuming?.setupProgress.jira
      ? `admin@${resuming.clientName.toLowerCase().replace(/\s+/g, "")}.com`
      : "",
  );
  const [jiraTest, setJiraTest] = useState<ConnState>(
    resuming?.setupProgress.jira ? "success" : "idle",
  );
  const [jiraResult, setJiraResult] = useState<{ projectName: string; ticketCount: number } | null>(
    resuming?.setupProgress.jira ? { projectName: resuming.jiraKey, ticketCount: 214 } : null,
  );

  // Step 3
  const [repoUrl, setRepoUrl] = useState(
    resuming?.setupProgress.github ? `https://github.com/${resuming.githubRepo}` : "",
  );
  const [ghToken, setGhToken] = useState(resuming?.setupProgress.github ? "••••••••••••" : "");
  const [branch, setBranch] = useState("main");
  const [ghTest, setGhTest] = useState<ConnState>(
    resuming?.setupProgress.github ? "success" : "idle",
  );
  const [ghResult, setGhResult] = useState<{ repoName: string; commitCount: number } | null>(
    resuming?.setupProgress.github ? { repoName: resuming.githubRepo, commitCount: 356 } : null,
  );

  // Step 4
  const [sowText, setSowText] = useState("");
  const [sowParsed, setSowParsed] = useState(Boolean(resuming?.setupProgress.sow));
  const [parsing, setParsing] = useState(false);
  const [deliverables, setDeliverables] = useState<Deliverable[]>(
    resuming?.setupProgress.sow
      ? [
          {
            id: "d1",
            name: "Legacy schema migration",
            criteria: "Zero-downtime cutover, verified row counts",
          },
          {
            id: "d2",
            name: "Data validation pipeline",
            criteria: "Automated reconciliation report per batch",
          },
        ]
      : [],
  );
  const [scopeExclusions, setScopeExclusions] = useState("");
  const [retentionDays, setRetentionDays] = useState(String(resuming?.retentionDays ?? 30));
  const [dpaReference, setDpaReference] = useState(resuming?.dpaReference ?? "");

  // Step 5
  const [search, setSearch] = useState("");
  const [pendingRole, setPendingRole] = useState<Record<string, TeamRole>>({});
  const [addedMembers, setAddedMembers] = useState<AddedMember[]>([
    { name: user.name, email: "", role: "Manager" },
  ]);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (resuming) setStep(firstIncompleteStep(resuming.setupProgress));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId]);

  const candidateUsers = useMemo(
    () =>
      allUsers.filter(
        (u) =>
          !addedMembers.some((m) => m.name === u.name) &&
          (search.trim() === "" ||
            u.name.toLowerCase().includes(search.toLowerCase()) ||
            u.email.toLowerCase().includes(search.toLowerCase())),
      ),
    [search, addedMembers],
  );

  function testJira() {
    setJiraTest("testing");
    setJiraResult(null);
    window.setTimeout(() => {
      const ok =
        jiraBaseUrl.trim() !== "" && jiraProjectKey.trim() !== "" && jiraApiToken.trim() !== "";
      if (ok) {
        setJiraTest("success");
        setJiraResult({ projectName: jiraProjectKey.toUpperCase(), ticketCount: 1247 });
      } else {
        setJiraTest("error");
      }
    }, 900);
  }

  function testGithub() {
    setGhTest("testing");
    setGhResult(null);
    window.setTimeout(() => {
      const ok = repoUrl.trim() !== "" && ghToken.trim() !== "";
      if (ok) {
        setGhTest("success");
        const repoName =
          repoUrl.replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "") || "repo";
        setGhResult({ repoName, commitCount: 892 });
      } else {
        setGhTest("error");
      }
    }, 900);
  }

  function parseSow() {
    setParsing(true);
    window.setTimeout(() => {
      setDeliverables([
        {
          id: "d1",
          name: "KRaft consensus migration",
          criteria: "Zookeeper fully decommissioned in staging + prod",
        },
        {
          id: "d2",
          name: "Consumer group protocol v2",
          criteria: "Backward-compatible rollout, no rebalance regressions",
        },
        {
          id: "d3",
          name: "Observability and metrics",
          criteria: "P99 dashboards for partition health, alerting wired",
        },
        {
          id: "d4",
          name: "Tiered storage retention",
          criteria: "Cold-tier offload verified against retention policy",
        },
        {
          id: "d5",
          name: "SASL auth hardening",
          criteria: "Token rotation with zero-downtime grace window",
        },
        {
          id: "d6",
          name: "Rack-aware partition assignor",
          criteria: "Assignor passes uneven-rack simulation suite",
        },
      ]);
      setSowParsed(true);
      setParsing(false);
    }, 1100);
  }

  function updateDeliverable(id: string, field: "name" | "criteria", value: string) {
    setDeliverables((prev) => prev.map((d) => (d.id === id ? { ...d, [field]: value } : d)));
  }

  function addDeliverableRow() {
    setDeliverables((prev) => [
      ...prev,
      { id: `d${prev.length + 1}-${Date.now()}`, name: "", criteria: "" },
    ]);
  }

  function removeDeliverable(id: string) {
    setDeliverables((prev) => prev.filter((d) => d.id !== id));
  }

  function addMember(name: string, email: string) {
    const role = pendingRole[name] ?? "Developer";
    setAddedMembers((prev) => [...prev, { name, email, role }]);
  }

  function removeMember(name: string) {
    setAddedMembers((prev) => prev.filter((m) => m.name !== name));
  }

  // Persists progress as the admin advances — matches the spec's "save on
  // Next" behaviour instead of only writing once at the very end. If the
  // project doesn't exist in the store yet (step 1, first time through),
  // this is what creates it with status='setup'.
  function persistStep(patch: Partial<MockProject>) {
    if (projectId) {
      updateMockProject(projectId, { ...patch, lastActivity: "just now" });
      return projectId;
    }
    const id = `proj-${Date.now()}`;
    const project: MockProject = {
      id,
      name: projectName || "Untitled project",
      clientName: clientName || "—",
      jiraKey: "—",
      githubRepo: "—",
      status: "setup",
      memberCount: 1,
      startDate: startDate || new Date().toISOString().slice(0, 10),
      retentionDays: null,
      dpaReference: "—",
      contractEnd: endDate || null,
      setupProgress: { details: false, jira: false, github: false, sow: false, team: false },
      lastActivity: "just now",
      ...patch,
    };
    addMockProject(project);
    setProjectId(id);
    return id;
  }

  // Merges a single step's completion into whatever progress the project
  // already has, so revisiting an earlier step via Back and hitting Next
  // again doesn't wipe out later steps that were already completed.
  function markStepDone(key: SetupStepKey, patch: Partial<MockProject> = {}) {
    const current = projectId ? getMockProject(projectId) : null;
    const progress = current?.setupProgress ?? {
      details: false,
      jira: false,
      github: false,
      sow: false,
      team: false,
    };
    persistStep({ ...patch, setupProgress: { ...progress, [key]: true } });
  }

  function nextFromStep1() {
    markStepDone("details", {
      name: projectName,
      clientName,
      startDate: startDate || new Date().toISOString().slice(0, 10),
      contractEnd: endDate || null,
    });
    setStep(1);
  }

  function nextFromStep2() {
    markStepDone("jira", { jiraKey: jiraProjectKey.toUpperCase() });
    setStep(2);
  }

  function nextFromStep3() {
    markStepDone("github", {
      githubRepo: ghResult?.repoName ?? repoUrl.replace(/^https?:\/\/github\.com\//, ""),
    });
    setStep(3);
  }

  function nextFromStep4() {
    markStepDone("sow", {
      retentionDays: Number(retentionDays) || null,
      dpaReference: dpaReference || "—",
    });
    setStep(4);
  }

  function finishSetup() {
    markStepDone("team", { status: "active", memberCount: addedMembers.length });
    setFinished(true);
  }

  const canNextStep1 = projectName.trim() !== "" && clientName.trim() !== "";
  const canNextStep2 = jiraTest === "success";
  const canNextStep3 = ghTest === "success";

  if (finished) {
    return (
      <AppShell user={user} title="New project">
        <PageSection>
          <Panel>
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-success-soft">
                <Check className="size-6 text-success" />
              </div>
              <h2 className="text-[16px] font-semibold text-ink">
                {(resuming?.name ?? projectName) || "Project"} is set up and active
              </h2>
              <p className="max-w-[360px] text-[13px] text-mute">
                First ingestion job has been queued. It'll show up in Ingestion logs shortly.
              </p>
              <div className="mt-2 flex gap-2">
                <GhostButton tone="brand" onClick={() => navigate({ to: "/admin/projects" })}>
                  Go to All projects
                </GhostButton>
                <GhostButton onClick={() => navigate({ to: "/admin/ingestion" })}>
                  View ingestion logs
                </GhostButton>
              </div>
            </div>
          </Panel>
        </PageSection>
      </AppShell>
    );
  }

  return (
    <AppShell user={user} title={resuming ? `Continue setup — ${resuming.name}` : "New project"}>
      <PageSection label="Project setup">
        {resuming && (
          <div className="mb-4 flex items-center justify-between rounded-lg border border-brand/30 bg-brand-soft px-3.5 py-2.5">
            <div>
              <p className="text-[13px] font-semibold text-ink">Resuming {resuming.name}</p>
              <p className="text-[12px] text-mute">
                {completedStepCount(resuming.setupProgress)} of {STEPS.length} steps already
                complete · last activity {resuming.lastActivity}
              </p>
            </div>
            <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-brand-foreground">
              {resuming.clientName}
            </span>
          </div>
        )}
        <StepProgress step={step} />

        <Panel>
          {step === 0 && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Project name">
                  <Input
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="e.g. Apache Kafka"
                  />
                </Field>
                <Field label="Client name">
                  <Input
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="e.g. Apache Software Foundation"
                  />
                </Field>
                <Field label="Start date">
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </Field>
                <Field label="Expected end date">
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </Field>
              </div>
              <Field label="Description (optional)">
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A short summary of this engagement…"
                  rows={3}
                />
              </Field>
              <WizardNav
                step={step}
                canNext={canNextStep1}
                onBack={() => {}}
                onNext={nextFromStep1}
              />
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Jira base URL">
                  <Input
                    value={jiraBaseUrl}
                    onChange={(e) => {
                      setJiraBaseUrl(e.target.value);
                      setJiraTest("idle");
                    }}
                    placeholder="https://yourcompany.atlassian.net"
                  />
                </Field>
                <Field label="Project key">
                  <Input
                    value={jiraProjectKey}
                    onChange={(e) => {
                      setJiraProjectKey(e.target.value);
                      setJiraTest("idle");
                    }}
                    placeholder="KAN"
                  />
                </Field>
                <Field label="Email">
                  <Input
                    type="email"
                    value={jiraEmail}
                    onChange={(e) => {
                      setJiraEmail(e.target.value);
                      setJiraTest("idle");
                    }}
                    placeholder="you@company.com"
                  />
                </Field>
                <Field label="API token">
                  <Input
                    type="password"
                    value={jiraApiToken}
                    onChange={(e) => {
                      setJiraApiToken(e.target.value);
                      setJiraTest("idle");
                    }}
                    placeholder="••••••••••••"
                  />
                </Field>
              </div>

              <div className="flex items-center gap-3">
                <GhostButton onClick={testJira} disabled={jiraTest === "testing"}>
                  {jiraTest === "testing" ? <Loader2 className="animate-spin" /> : null}
                  Test connection
                </GhostButton>
                {jiraTest === "success" && jiraResult && (
                  <span className="flex items-center gap-1.5 text-[13px] font-medium text-success">
                    <Check className="size-3.5" /> Found {jiraResult.projectName} —{" "}
                    {jiraResult.ticketCount.toLocaleString()} tickets
                  </span>
                )}
                {jiraTest === "error" && (
                  <span className="flex items-center gap-1.5 text-[13px] font-medium text-danger">
                    <X className="size-3.5" /> Authentication failed — check base URL, key and token
                  </span>
                )}
              </div>

              <WizardNav
                step={step}
                canNext={canNextStep2}
                onBack={() => setStep(0)}
                onNext={nextFromStep2}
              />
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Repository URL">
                  <Input
                    value={repoUrl}
                    onChange={(e) => {
                      setRepoUrl(e.target.value);
                      setGhTest("idle");
                    }}
                    placeholder="https://github.com/apache/kafka"
                  />
                </Field>
                <Field label="Branch to track">
                  <Input
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="main"
                  />
                </Field>
                <Field label="Personal access token">
                  <Input
                    type="password"
                    value={ghToken}
                    onChange={(e) => {
                      setGhToken(e.target.value);
                      setGhTest("idle");
                    }}
                    placeholder="••••••••••••"
                  />
                </Field>
              </div>

              <div className="flex items-center gap-3">
                <GhostButton onClick={testGithub} disabled={ghTest === "testing"}>
                  {ghTest === "testing" ? <Loader2 className="animate-spin" /> : <Github />}
                  Test connection
                </GhostButton>
                {ghTest === "success" && ghResult && (
                  <span className="flex items-center gap-1.5 text-[13px] font-medium text-success">
                    <Check className="size-3.5" /> {ghResult.repoName} —{" "}
                    {ghResult.commitCount.toLocaleString()} commits found
                  </span>
                )}
                {ghTest === "error" && (
                  <span className="flex items-center gap-1.5 text-[13px] font-medium text-danger">
                    <X className="size-3.5" /> Couldn't reach that repository — check URL and token
                  </span>
                )}
              </div>

              <WizardNav
                step={step}
                canNext={canNextStep3}
                onBack={() => setStep(1)}
                onNext={nextFromStep3}
              />
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-4">
              {!sowParsed ? (
                <>
                  <Field label="Statement of work">
                    <Textarea
                      value={sowText}
                      onChange={(e) => setSowText(e.target.value)}
                      placeholder="Paste the SOW text here, or attach a PDF (demo: parsing uses sample deliverables)…"
                      rows={8}
                    />
                  </Field>
                  <div className="flex items-center gap-3">
                    <GhostButton tone="brand" onClick={parseSow} disabled={parsing}>
                      {parsing ? <Loader2 className="animate-spin" /> : null}
                      Parse SOW
                    </GhostButton>
                    <button
                      type="button"
                      className="text-[13px] font-medium text-mute underline-offset-2 hover:text-ink hover:underline"
                      onClick={nextFromStep4}
                    >
                      Skip for now
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[13px] font-medium text-ink">
                    Found {deliverables.length} deliverables — confirm below before continuing
                  </p>
                  <div className="flex flex-col gap-2">
                    {deliverables.map((d, i) => (
                      <div key={d.id} className="flex items-center gap-2">
                        <span className="w-7 shrink-0 text-[12px] font-semibold text-mute">
                          D{i + 1}
                        </span>
                        <Input
                          value={d.name}
                          onChange={(e) => updateDeliverable(d.id, "name", e.target.value)}
                          placeholder="Deliverable name"
                          className="flex-grow"
                        />
                        <Input
                          value={d.criteria}
                          onChange={(e) => updateDeliverable(d.id, "criteria", e.target.value)}
                          placeholder="Acceptance criteria"
                          className="flex-grow"
                        />
                        <button
                          type="button"
                          onClick={() => removeDeliverable(d.id)}
                          className="shrink-0 text-mute hover:text-danger"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ))}
                    <GhostButton onClick={addDeliverableRow} className="w-fit">
                      <Plus /> Add deliverable row
                    </GhostButton>
                  </div>

                  <Field label="Scope exclusions">
                    <Textarea
                      value={scopeExclusions}
                      onChange={(e) => setScopeExclusions(e.target.value)}
                      placeholder="Anything outside these deliverables is out of scope:"
                      rows={3}
                    />
                  </Field>

                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Retention period (days after contract end)">
                      <Input
                        type="number"
                        value={retentionDays}
                        onChange={(e) => setRetentionDays(e.target.value)}
                      />
                    </Field>
                    <Field label="DPA reference">
                      <Input
                        value={dpaReference}
                        onChange={(e) => setDpaReference(e.target.value)}
                        placeholder="DPA-2026-XXX"
                      />
                    </Field>
                  </div>
                </>
              )}

              <WizardNav
                step={step}
                canNext={true}
                onBack={() => setStep(2)}
                onNext={nextFromStep4}
              />
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-col gap-4">
              <Field label="Search users by name or email">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search…"
                />
              </Field>

              {candidateUsers.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {candidateUsers.map((u) => (
                    <div
                      key={u.email}
                      className="flex items-center gap-3 rounded-lg bg-surface-sunken px-3 py-2"
                    >
                      <span className="size-1.5 shrink-0 rounded-full bg-mute" />
                      <span className="w-40 shrink-0 truncate text-[13px] text-ink">{u.name}</span>
                      <span className="flex-grow truncate text-[12px] text-mute">{u.email}</span>
                      <Select
                        value={pendingRole[u.name] ?? "Developer"}
                        onValueChange={(v) =>
                          setPendingRole((prev) => ({ ...prev, [u.name]: v as TeamRole }))
                        }
                      >
                        <SelectTrigger className="h-7 w-32 text-[12px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Developer">Developer</SelectItem>
                          <SelectItem value="Manager">Manager</SelectItem>
                          <SelectItem value="Observer">Observer</SelectItem>
                        </SelectContent>
                      </Select>
                      <GhostButton tone="brand" onClick={() => addMember(u.name, u.email)}>
                        Add
                      </GhostButton>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <h3 className="section-label mb-1.5">Already added</h3>
                <div className="flex flex-col gap-1.5">
                  {addedMembers.map((m) => (
                    <div
                      key={m.name}
                      className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
                    >
                      <span className="size-1.5 shrink-0 rounded-full bg-success" />
                      <span className="w-40 shrink-0 truncate text-[13px] text-ink">{m.name}</span>
                      <span className="flex-grow truncate text-[12px] text-mute">
                        {m.email || "—"}
                      </span>
                      <span className="text-[12px] font-medium text-mute">{m.role}</span>
                      <GhostButton tone="danger" onClick={() => removeMember(m.name)}>
                        Remove
                      </GhostButton>
                    </div>
                  ))}
                </div>
              </div>

              <WizardNav
                step={step}
                canNext={true}
                onBack={() => setStep(3)}
                onNext={finishSetup}
                nextLabel="Finish setup"
              />
            </div>
          )}
        </Panel>

        {step === 3 && !sowParsed && (
          <p className="mt-3 flex items-center gap-1.5 text-[12px] text-mute">
            <CircleAlert className="size-3.5" /> SOW parsing is optional — you can skip and confirm
            deliverables later.
          </p>
        )}
      </PageSection>
    </AppShell>
  );
}
