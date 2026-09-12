import { Check, Eye, EyeOff, FileText, Github, Loader2, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GhostButton } from "@/components/relay/primitives";
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
  SETUP_STEPS,
  firstIncompleteStep,
  getMockProject,
  updateMockProject,
  addMockProject,
  type MockProject,
  type SetupStepKey,
} from "@/lib/admin/mockProjects";
import { allUsers } from "@/lib/mockData";

const STEP_LABELS = ["Details", "Jira", "GitHub", "SOW", "Team"] as const;

type Deliverable = { id: string; name: string };
type TeamRole = "Developer" | "Manager" | "Observer";
type AddedMember = { name: string; email: string; role: TeamRole };
type ConnState = "idle" | "testing" | "success";

const AVAILABLE_CANDIDATES = [
  { name: "Ravi Gupta", email: "ravi@relay.dev" },
  { name: "Priya Sharma", email: "priya@relay.dev" },
  { name: "Omar Hassan", email: "omar@relay.dev" },
];

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function StepProgress({ step }: { step: number }) {
  return (
    <div className="mb-6 flex items-center gap-1.5">
      {STEP_LABELS.map((label, i) => (
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
          {i < STEP_LABELS.length - 1 && <div className="mx-1 h-px flex-grow bg-border" />}
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

export function ProjectWizardDialog({
  open,
  onOpenChange,
  resumeProjectId,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resumeProjectId: string | null;
  onChanged: () => void;
}) {
  const resuming = useMemo(
    () => (resumeProjectId ? getMockProject(resumeProjectId) : null),
    [resumeProjectId],
  );
  const [step, setStep] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(null);

  // Step 1 — Details
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [jiraKeyHint, setJiraKeyHint] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [description, setDescription] = useState("");
  const [retentionDays, setRetentionDays] = useState("30");

  // Step 2 — Jira
  const [jiraBaseUrl, setJiraBaseUrl] = useState("");
  const [jiraProjectKey, setJiraProjectKey] = useState("");
  const [jiraEmail, setJiraEmail] = useState("");
  const [jiraApiToken, setJiraApiToken] = useState("");
  const [jiraTest, setJiraTest] = useState<ConnState>("idle");
  const [jiraResult, setJiraResult] = useState<{ key: string; count: number } | null>(null);

  // Step 3 — GitHub
  const [repoUrl, setRepoUrl] = useState("");
  const [ghToken, setGhToken] = useState("");
  const [ghTokenVisible, setGhTokenVisible] = useState(false);
  const [branch, setBranch] = useState("main");
  const [ghTest, setGhTest] = useState<ConnState>("idle");
  const [ghResult, setGhResult] = useState<{ repo: string; commits: number } | null>(null);

  // Step 4 — SOW
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [scopeExclusions, setScopeExclusions] = useState("");
  const [sowRetentionDays, setSowRetentionDays] = useState("30");
  const [dpaReference, setDpaReference] = useState("");

  // Step 5 — Team
  const [search, setSearch] = useState("");
  const [pendingRole, setPendingRole] = useState<Record<string, TeamRole>>({});
  const [addedMembers, setAddedMembers] = useState<AddedMember[]>([]);

  useEffect(() => {
    if (!open) return;
    if (resuming) {
      setStep(firstIncompleteStep(resuming.setupProgress));
      setProjectId(resuming.id);
      setProjectName(resuming.name);
      setClientName(resuming.clientName);
      setJiraKeyHint(resuming.jiraKey === "—" ? "" : resuming.jiraKey);
      setStartDate(resuming.startDate);
      setEndDate(resuming.contractEnd ?? "");
      setJiraBaseUrl(resuming.setupProgress.jira ? `https://${resuming.jiraBaseUrl}` : "");
      setJiraProjectKey(resuming.jiraKey === "—" ? "" : resuming.jiraKey);
      setJiraEmail(resuming.setupProgress.jira ? "admin@acmecorp.com" : "");
      setJiraApiToken(resuming.setupProgress.jira ? "••••••••••••••••••••••" : "");
      setJiraTest(resuming.setupProgress.jira ? "success" : "idle");
      setJiraResult(
        resuming.setupProgress.jira ? { key: resuming.jiraKey, count: resuming.ticketCount } : null,
      );
      setRepoUrl(resuming.setupProgress.github ? `https://github.com/${resuming.githubRepo}` : "");
      setGhTest(resuming.setupProgress.github ? "success" : "idle");
      setGhResult(
        resuming.setupProgress.github
          ? { repo: resuming.githubRepo, commits: resuming.commitCount }
          : null,
      );
      setDeliverables([
        { id: "d1", name: "Data extraction pipeline" },
        { id: "d2", name: "Transformation scripts" },
      ]);
      setScopeExclusions("UI layer and frontend are explicitly out of scope");
      setSowRetentionDays(String(resuming.retentionDays ?? 30));
      setDpaReference(resuming.dpaReference === "—" ? "" : resuming.dpaReference);
      setAddedMembers(resuming.team.map((m) => ({ name: m.name, email: "", role: m.role as TeamRole })));
    } else {
      setStep(0);
      setProjectId(null);
      setProjectName("");
      setClientName("");
      setJiraKeyHint("");
      setStartDate("");
      setEndDate("");
      setDescription("");
      setRetentionDays("30");
      setJiraBaseUrl("");
      setJiraProjectKey("");
      setJiraEmail("");
      setJiraApiToken("");
      setJiraTest("idle");
      setJiraResult(null);
      setRepoUrl("");
      setGhToken("");
      setBranch("main");
      setGhTest("idle");
      setGhResult(null);
      setDeliverables([
        { id: "d1", name: "Data extraction pipeline" },
        { id: "d2", name: "Transformation scripts" },
      ]);
      setScopeExclusions("");
      setSowRetentionDays("30");
      setDpaReference("");
      setAddedMembers([{ name: "Anya Gupta", email: "", role: "Manager" }]);
    }
  }, [open, resumeProjectId]);

  const candidates = useMemo(
    () =>
      AVAILABLE_CANDIDATES.filter(
        (c) =>
          !addedMembers.some((m) => m.name === c.name) &&
          (search.trim() === "" || c.name.toLowerCase().includes(search.toLowerCase())),
      ),
    [search, addedMembers],
  );

  function persistStep(patch: Partial<MockProject>) {
    if (projectId) {
      updateMockProject(projectId, { ...patch, lastActivity: "just now" });
      onChanged();
      return projectId;
    }
    const id = `proj-${Date.now()}`;
    const project: MockProject = {
      id,
      name: projectName || "Untitled project",
      clientName: clientName || "—",
      jiraKey: jiraKeyHint || "—",
      jiraBaseUrl: "—",
      githubRepo: "—",
      status: "setup",
      memberCount: 1,
      startDate: startDate || new Date().toISOString().slice(0, 10),
      retentionDays: Number(retentionDays) || null,
      dpaReference: "—",
      contractEnd: endDate || null,
      setupProgress: { details: false, jira: false, github: false, sow: false, team: false },
      lastActivity: "just now",
      ticketCount: 0,
      commitCount: 0,
      coveragePct: 0,
      chunksCount: 0,
      lastSync: "—",
      team: [{ initials: "AG", name: "Anya Gupta", role: "Manager" }],
      ...patch,
    };
    addMockProject(project);
    setProjectId(id);
    onChanged();
    return id;
  }

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

  function testJira() {
    setJiraTest("testing");
    window.setTimeout(() => {
      setJiraTest("success");
      setJiraResult({ key: (jiraProjectKey || "KAN").toUpperCase(), count: 1247 });
    }, 1500);
  }

  function testGithub() {
    setGhTest("testing");
    window.setTimeout(() => {
      const repo =
        repoUrl.replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "") ||
        "acme-corp/data-migration";
      setGhTest("success");
      setGhResult({ repo, commits: 234 });
    }, 1500);
  }

  function addDeliverable() {
    setDeliverables((prev) => [...prev, { id: `d${prev.length + 1}-${Date.now()}`, name: "" }]);
  }

  function updateDeliverable(id: string, name: string) {
    setDeliverables((prev) => prev.map((d) => (d.id === id ? { ...d, name } : d)));
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

  function nextFromStep1() {
    markStepDone("details", {
      name: projectName,
      clientName,
      ...(jiraKeyHint ? { jiraKey: jiraKeyHint.toUpperCase() } : {}),
      startDate: startDate || new Date().toISOString().slice(0, 10),
      contractEnd: endDate || null,
      retentionDays: Number(retentionDays) || null,
    });
    setStep(1);
  }

  function nextFromStep2() {
    markStepDone("jira", {
      jiraKey: jiraProjectKey.toUpperCase(),
      jiraBaseUrl: jiraBaseUrl.replace(/^https?:\/\//, "").replace(/\/$/, ""),
      ticketCount: jiraResult?.count ?? 0,
    });
    setStep(2);
  }

  function nextFromStep3() {
    markStepDone("github", {
      githubRepo: ghResult?.repo ?? repoUrl.replace(/^https?:\/\/github\.com\//, ""),
      commitCount: ghResult?.commits ?? 0,
    });
    setStep(3);
  }

  function nextFromStep4() {
    markStepDone("sow", {
      retentionDays: Number(sowRetentionDays) || null,
      dpaReference: dpaReference || "—",
    });
    setStep(4);
  }

  function finishSetup() {
    markStepDone("team", {
      status: "active",
      memberCount: addedMembers.length,
      team: addedMembers.map((m) => ({ initials: initialsOf(m.name), name: m.name, role: m.role })),
    });
    onOpenChange(false);
    const finishedProject = projectId ? getMockProject(projectId) : null;
    toast(`${finishedProject?.name ?? "Project"} is now active`);
  }

  const canNextStep1 = projectName.trim() !== "" && clientName.trim() !== "";
  const canNextStep2 = jiraTest === "success";
  const canNextStep3 = ghTest === "success";

  const title = resuming ? resuming.name : projectName || "Create new project";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[640px] gap-0 rounded-xl p-6">
        <DialogHeader className="mb-1">
          <DialogTitle className="text-[15px]">
            {step === 0 && !resuming ? "Create new project" : title}
          </DialogTitle>
        </DialogHeader>

        <StepProgress step={step} />

        {step === 0 && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Project name *">
                <Input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="e.g. Apache Kafka"
                />
              </Field>
              <Field label="Client name *">
                <Input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="e.g. Apache Software Foundation"
                />
              </Field>
            </div>
            <Field label="Jira project key">
              <Input
                value={jiraKeyHint}
                onChange={(e) => setJiraKeyHint(e.target.value)}
                placeholder="e.g. KAN"
                className="w-24"
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Start date">
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
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
            <Field label="Retention policy — days after contract end">
              <Input
                type="number"
                value={retentionDays}
                onChange={(e) => setRetentionDays(e.target.value)}
                className="w-24"
              />
            </Field>
            <div className="mt-2 flex justify-end border-t border-border pt-4">
              <GhostButton tone="brand" onClick={nextFromStep1} disabled={!canNextStep1}>
                Save and continue →
              </GhostButton>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-4">
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
            <div className="grid grid-cols-2 gap-4">
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
                  placeholder="your@email.com"
                />
              </Field>
            </div>
            <Field label="API token">
              <Input
                type="password"
                value={jiraApiToken}
                onChange={(e) => {
                  setJiraApiToken(e.target.value);
                  setJiraTest("idle");
                }}
                placeholder="••••••••••••••••••••••"
              />
            </Field>
            <div className="flex items-center justify-end gap-3">
              {jiraTest === "success" && jiraResult && (
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-success">
                  <Check className="size-3.5" /> Found {jiraResult.key} —{" "}
                  {jiraResult.count.toLocaleString()} tickets
                </span>
              )}
              <GhostButton onClick={testJira} disabled={jiraTest === "testing"}>
                {jiraTest === "testing" ? <Loader2 className="animate-spin" /> : null}
                Test connection →
              </GhostButton>
            </div>
            <div className="mt-2 flex justify-end border-t border-border pt-4">
              <GhostButton tone="brand" onClick={nextFromStep2} disabled={!canNextStep2}>
                Next →
              </GhostButton>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4">
            <Field label="Repository URL">
              <Input
                value={repoUrl}
                onChange={(e) => {
                  setRepoUrl(e.target.value);
                  setGhTest("idle");
                }}
                placeholder="https://github.com/acme-corp/data-migration"
              />
            </Field>
            <Field label="Personal access token (read:repo scope only)">
              <div className="flex items-center gap-2">
                <Input
                  type={ghTokenVisible ? "text" : "password"}
                  value={ghToken}
                  onChange={(e) => {
                    setGhToken(e.target.value);
                    setGhTest("idle");
                  }}
                  placeholder="••••••••••••••••••••••"
                  className="flex-grow"
                />
                <GhostButton onClick={() => setGhTokenVisible((v) => !v)}>
                  {ghTokenVisible ? <EyeOff /> : <Eye />} {ghTokenVisible ? "Hide" : "Show"}
                </GhostButton>
              </div>
            </Field>
            <Field label="Branch to track">
              <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
            </Field>
            <div className="flex items-center justify-end gap-3">
              {ghTest === "success" && ghResult && (
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-success">
                  <Check className="size-3.5" /> {ghResult.repo} —{" "}
                  {ghResult.commits.toLocaleString()} commits found
                </span>
              )}
              <GhostButton onClick={testGithub} disabled={ghTest === "testing"}>
                {ghTest === "testing" ? <Loader2 className="animate-spin" /> : <Github />}
                Test connection →
              </GhostButton>
            </div>
            <div className="mt-2 flex justify-end border-t border-border pt-4">
              <GhostButton tone="brand" onClick={nextFromStep3} disabled={!canNextStep3}>
                Next →
              </GhostButton>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-4">
            <button
              type="button"
              onClick={() => toast("File upload available in production.")}
              className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-6 text-center text-[13px] text-mute hover:border-brand hover:text-brand"
            >
              <FileText className="size-5" />
              Drop PDF here or click to upload
              <span className="text-[11px]">or paste deliverables manually below</span>
            </button>

            <div>
              <label className="section-label">Deliverables (we'll parse these from the PDF)</label>
              <div className="mt-1.5 flex flex-col gap-1.5">
                {deliverables.map((d, i) => (
                  <div key={d.id} className="flex items-center gap-2">
                    <span className="w-7 shrink-0 text-[12px] font-semibold text-mute">
                      D{i + 1}
                    </span>
                    <Input
                      value={d.name}
                      onChange={(e) => updateDeliverable(d.id, e.target.value)}
                      placeholder="Deliverable name"
                      className="flex-grow"
                    />
                    <button
                      type="button"
                      onClick={() => removeDeliverable(d.id)}
                      className="shrink-0 text-mute hover:text-danger"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
                <GhostButton onClick={addDeliverable} className="w-fit">
                  <Plus /> Add deliverable
                </GhostButton>
              </div>
            </div>

            <Field label="Scope exclusions">
              <Textarea
                value={scopeExclusions}
                onChange={(e) => setScopeExclusions(e.target.value)}
                rows={2}
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Retention period — days after contract end">
                <Input
                  type="number"
                  value={sowRetentionDays}
                  onChange={(e) => setSowRetentionDays(e.target.value)}
                />
              </Field>
              <Field label="DPA reference">
                <Input
                  value={dpaReference}
                  onChange={(e) => setDpaReference(e.target.value)}
                  placeholder="DPA-2026-002"
                />
              </Field>
            </div>

            <div className="mt-2 flex justify-between border-t border-border pt-4">
              <GhostButton onClick={() => setStep(2)}>← Back</GhostButton>
              <GhostButton tone="brand" onClick={nextFromStep4}>
                Save and continue →
              </GhostButton>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col gap-4">
            <Field label="Search by name or email">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
              />
            </Field>

            <div>
              <p className="section-label mb-1.5">Available</p>
              <div className="flex flex-col gap-1.5">
                {candidates.length === 0 && (
                  <p className="text-[12px] text-mute">No matching people.</p>
                )}
                {candidates.map((c) => (
                  <div
                    key={c.email}
                    className="flex items-center gap-3 rounded-lg bg-surface-sunken px-3 py-2"
                  >
                    <span className="w-32 shrink-0 truncate text-[13px] text-ink">{c.name}</span>
                    <span className="flex-grow truncate text-[12px] text-mute">{c.email}</span>
                    <Select
                      value={pendingRole[c.name] ?? "Developer"}
                      onValueChange={(v) =>
                        setPendingRole((prev) => ({ ...prev, [c.name]: v as TeamRole }))
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
                    <GhostButton tone="brand" onClick={() => addMember(c.name, c.email)}>
                      Add →
                    </GhostButton>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="section-label mb-1.5">Already added</p>
              <div className="flex flex-col gap-1.5">
                {addedMembers.map((m) => (
                  <div
                    key={m.name}
                    className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
                  >
                    <span className="w-32 shrink-0 truncate text-[13px] text-ink">{m.name}</span>
                    <span className="flex-grow truncate text-[12px] text-mute">{m.role}</span>
                    <GhostButton tone="danger" onClick={() => removeMember(m.name)}>
                      Remove
                    </GhostButton>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-2 flex justify-between border-t border-border pt-4">
              <GhostButton onClick={() => setStep(3)}>← Back</GhostButton>
              <GhostButton tone="brand" onClick={finishSetup}>
                Finish setup →
              </GhostButton>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
