import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Check,
  CircleAlert,
  FileText,
  Github,
  Loader2,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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

export const Route = createFileRoute("/_authenticated/admin/projects_/new")({
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

// The FastAPI backend (backend/main.py) — same pattern as every other route
// that calls it (e.g. _authenticated.dev.ask.tsx).
const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

const STEPS = ["Project details", "Jira", "GitHub", "SOW", "Team"] as const;

type Deliverable = {
  id: string;
  name: string;
  criteria: string;
  sourcePage: number | null;
  isBackend: boolean;
  // Which uploaded SOW this came from — lets the UI group "which
  // deliverables were from what" instead of one flat undifferentiated list
  // once more than one document has been uploaded.
  sourceDocId: string;
  sourceFileName: string;
};

type SowDocument = {
  id: string;
  file_name: string;
  page_count: number | null;
  scope_exclusions: string | null;
  status: "uploaded" | "parsing" | "parsed" | "failed";
  parse_error: string | null;
  uploaded_at?: string;
  deliverables?: {
    id: string;
    name: string;
    acceptance_criteria: string | null;
    source_page: number | null;
  }[];
};
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
  // Real public.projects.engagement_id — created on Step 1 (see
  // ensureBackendProject) so every step after that, including the SOW
  // upload, attaches to a real backend project instead of a mock-only one.
  const [engagementId, setEngagementId] = useState<string | null>(resuming?.engagementId ?? null);

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

  // Step 4 — real upload against POST /api/admin/sow/upload (backend/api/sow.py).
  // Multiple SOWs can be uploaded for one project — sowDocs tracks every
  // document uploaded so far (this session or a prior one), and each
  // Deliverable below carries sourceDocId/sourceFileName so the UI can
  // group them by document instead of merging into one undifferentiated list.
  const [sowFile, setSowFile] = useState<File | null>(null);
  const [sowDocs, setSowDocs] = useState<SowDocument[]>([]);
  const [sowParsed, setSowParsed] = useState(Boolean(resuming?.setupProgress.sow));
  const [parsing, setParsing] = useState(false);
  const [sowUploadError, setSowUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
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

  // Resuming a project that already has SOWs uploaded (from an earlier
  // session) shouldn't show an empty Step 4 — load what's already there.
  useEffect(() => {
    if (!engagementId) return;
    let cancelled = false;
    fetch(`${API_URL}/api/admin/sow?engagement_id=${engagementId}&include_deliverables=true`)
      .then((res) => (res.ok ? res.json() : []))
      .then((docs: SowDocument[]) => {
        if (cancelled || docs.length === 0) return;
        setSowDocs(docs);
        setDeliverables(
          docs.flatMap((doc) =>
            (doc.deliverables ?? []).map((d) => ({
              id: d.id,
              name: d.name,
              criteria: d.acceptance_criteria ?? "",
              sourcePage: d.source_page,
              isBackend: true,
              sourceDocId: doc.id,
              sourceFileName: doc.file_name,
            })),
          ),
        );
        setScopeExclusions(
          docs
            .filter((d) => d.scope_exclusions)
            .map((d) => `From ${d.file_name}: ${d.scope_exclusions}`)
            .join("\n\n"),
        );
        if (docs.some((d) => d.status === "parsed")) setSowParsed(true);
      })
      .catch(() => {
        // Best-effort — the wizard still works for a fresh upload either way.
      });
    return () => {
      cancelled = true;
    };
  }, [engagementId]);

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

  // Real pipeline: upload -> backend saves the PDF, extracts text, chunks +
  // embeds it into public.chunks, and asks Gemini for structured
  // deliverables — see backend/api/sow.py. This one request does the whole
  // thing synchronously, so "parsing" stays true until it resolves.
  //
  // Multiple documents can be uploaded one after another: each successful
  // parse is APPENDED to sowDocs/deliverables rather than replacing the
  // previous document's results, so uploading a second SOW doesn't erase
  // the first one's deliverables.
  async function uploadSow() {
    if (!sowFile) return;
    setParsing(true);
    setSowUploadError(null);
    try {
      const id = engagementId ?? (await ensureBackendProject());
      if (!id) {
        throw new Error(
          "Couldn't reach the backend to create the project — check it's running before uploading",
        );
      }
      const form = new FormData();
      form.append("file", sowFile);
      form.append("engagement_id", id);
      form.append("uploaded_by", user.email || user.name);

      const res = await fetch(`${API_URL}/api/admin/sow/upload`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Upload failed (${res.status})`);
      }
      const doc: SowDocument = await res.json();

      if (doc.status === "failed") {
        setSowDocs((prev) => [...prev, doc]);
        setSowUploadError(doc.parse_error || "Parsing failed for an unknown reason");
        return;
      }

      // Upload response doesn't include deliverables — fetch the full
      // document now that parsing has finished.
      const detailRes = await fetch(`${API_URL}/api/admin/sow/${doc.id}`);
      if (!detailRes.ok) throw new Error("Uploaded, but couldn't load parsed deliverables");
      const detail: SowDocument = await detailRes.json();

      setSowDocs((prev) => [...prev, detail]);
      setDeliverables((prev) => [
        ...prev,
        ...(detail.deliverables ?? []).map((d) => ({
          id: d.id,
          name: d.name,
          criteria: d.acceptance_criteria ?? "",
          sourcePage: d.source_page,
          isBackend: true,
          sourceDocId: doc.id,
          sourceFileName: doc.file_name,
        })),
      ]);
      if (detail.scope_exclusions) {
        setScopeExclusions((prev) =>
          prev
            ? `${prev}\n\nFrom ${doc.file_name}: ${detail.scope_exclusions}`
            : `From ${doc.file_name}: ${detail.scope_exclusions}`,
        );
      }
      setSowParsed(true);
      setSowFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setSowUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setParsing(false);
    }
  }

  // Clears a failed upload (e.g. after a transient error like a Gemini
  // quota limit) so it doesn't clutter the list before retrying.
  async function removeSowDocument(docId: string) {
    setSowDocs((prev) => prev.filter((d) => d.id !== docId));
    setDeliverables((prev) => prev.filter((d) => d.sourceDocId !== docId));
    try {
      await fetch(`${API_URL}/api/admin/sow/${docId}`, { method: "DELETE" });
    } catch {
      // Best-effort — it's already gone from the wizard's view either way.
    }
  }

  function updateDeliverable(id: string, field: "name" | "criteria", value: string) {
    setDeliverables((prev) => prev.map((d) => (d.id === id ? { ...d, [field]: value } : d)));
  }

  // Backend-sourced rows persist edits on blur (PATCH); ad-hoc rows added
  // via "Add deliverable row" have no backend counterpart yet and stay
  // local-only, same as the rest of this still-mock wizard.
  function persistDeliverableEdit(d: Deliverable) {
    if (!d.isBackend) return;
    fetch(`${API_URL}/api/admin/sow/deliverables/${d.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: d.name, acceptance_criteria: d.criteria }),
    }).catch(() => {
      // Best-effort — the field keeps its edited value locally either way.
    });
  }

  function addDeliverableRow() {
    setDeliverables((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        name: "",
        criteria: "",
        sourcePage: null,
        isBackend: false,
        sourceDocId: "manual",
        sourceFileName: "Added manually",
      },
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
      jiraBaseUrl: "—",
      githubRepo: "—",
      status: "setup",
      memberCount: 1,
      startDate: startDate || new Date().toISOString().slice(0, 10),
      retentionDays: null,
      dpaReference: "—",
      contractEnd: endDate || null,
      setupProgress: { details: false, jira: false, github: false, sow: false, team: false },
      lastActivity: "just now",
      ticketCount: 0,
      commitCount: 0,
      coveragePct: 0,
      chunksCount: 0,
      lastSync: "—",
      team: [{ initials: "AG", name: user.name, role: "Manager" }],
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

  // Creates the real public.projects row the first time it's needed (Step 1,
  // normally) and reuses it after. Best-effort: if the backend is
  // unreachable this returns null and the wizard still progresses through
  // its local mock state — only the SOW upload step hard-requires a real id.
  async function ensureBackendProject(): Promise<string | null> {
    if (engagementId) return engagementId;
    try {
      const res = await fetch(`${API_URL}/api/admin/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: projectName || "Untitled project",
          client_name: clientName || "—",
          start_date: startDate || null,
          end_date: endDate || null,
          created_by: user.email || user.name,
        }),
      });
      if (!res.ok) return null;
      const proj: { engagement_id: string } = await res.json();
      setEngagementId(proj.engagement_id);
      return proj.engagement_id;
    } catch {
      return null;
    }
  }

  // Each wizard step writes to its own linked table (project_jira_links,
  // project_github_links, project_governance — database/project_setup.sql)
  // rather than one flat PATCH on public.projects, so e.g. re-testing a
  // Jira connection later doesn't touch GitHub/governance rows at all.
  async function putBackendLink(path: string, body: Record<string, unknown>) {
    const id = engagementId ?? (await ensureBackendProject());
    if (!id) return;
    try {
      await fetch(`${API_URL}/api/admin/projects/${id}/${path}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      // Best-effort — the wizard's own progress tracking doesn't depend on this.
    }
  }

  async function patchBackendProject(patch: Record<string, unknown>) {
    const id = engagementId ?? (await ensureBackendProject());
    if (!id) return;
    try {
      await fetch(`${API_URL}/api/admin/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch {
      // Best-effort — the wizard's own progress tracking doesn't depend on this.
    }
  }

  async function nextFromStep1() {
    const id = await ensureBackendProject();
    markStepDone("details", {
      name: projectName,
      clientName,
      startDate: startDate || new Date().toISOString().slice(0, 10),
      contractEnd: endDate || null,
      ...(id ? { engagementId: id } : {}),
    });
    setStep(1);
  }

  function nextFromStep2() {
    putBackendLink("jira", { base_url: jiraBaseUrl, project_key: jiraProjectKey.toUpperCase() });
    markStepDone("jira", { jiraKey: jiraProjectKey.toUpperCase() });
    setStep(2);
  }

  function nextFromStep3() {
    const repoName = ghResult?.repoName ?? repoUrl.replace(/^https?:\/\/github\.com\//, "");
    putBackendLink("github", { repo_url: repoUrl, branch });
    markStepDone("github", { githubRepo: repoName });
    setStep(3);
  }

  function nextFromStep4() {
    putBackendLink("governance", {
      retention_days: Number(retentionDays) || null,
      dpa_reference: dpaReference || null,
    });
    markStepDone("sow", {
      retentionDays: Number(retentionDays) || null,
      dpaReference: dpaReference || "—",
    });
    setStep(4);
  }

  function finishSetup() {
    patchBackendProject({ status: "active" });
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
              {sowDocs.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="section-label">Uploaded documents</span>
                  {sowDocs.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
                    >
                      <FileText className="size-3.5 shrink-0 text-mute" />
                      <span className="flex-grow truncate text-[13px] text-ink">
                        {doc.file_name}
                      </span>
                      {doc.status === "parsed" && (
                        <span className="flex items-center gap-1 text-[11px] font-medium text-success">
                          <Check className="size-3 shrink-0" />
                          {doc.deliverables?.length ?? 0} deliverables
                        </span>
                      )}
                      {doc.status === "failed" && (
                        <span
                          className="flex items-center gap-1 text-[11px] font-medium text-danger"
                          title={doc.parse_error ?? undefined}
                        >
                          <X className="size-3 shrink-0" /> Parse failed
                        </span>
                      )}
                      {doc.status === "failed" && (
                        <button
                          type="button"
                          onClick={() => removeSowDocument(doc.id)}
                          className="shrink-0 text-mute hover:text-danger"
                          title="Remove and retry"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <Field
                label={sowDocs.length > 0 ? "Upload another SOW (PDF)" : "Statement of work (PDF)"}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    setSowFile(e.target.files?.[0] ?? null);
                    setSowUploadError(null);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2.5 rounded-lg border border-dashed border-border px-4 py-6 text-[13px] text-mute hover:border-brand hover:text-ink"
                >
                  {sowFile ? (
                    <>
                      <FileText className="size-4 shrink-0" />
                      <span className="truncate font-medium text-ink">{sowFile.name}</span>
                      <span className="shrink-0 text-mute">
                        ({(sowFile.size / 1024).toFixed(0)} KB)
                      </span>
                    </>
                  ) : (
                    <>
                      <Upload className="size-4 shrink-0" />
                      Click to choose a PDF
                    </>
                  )}
                </button>
              </Field>
              {sowUploadError && (
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-danger">
                  <X className="size-3.5" /> {sowUploadError}
                </span>
              )}
              <div className="flex items-center gap-3">
                <GhostButton tone="brand" onClick={uploadSow} disabled={!sowFile || parsing}>
                  {parsing ? <Loader2 className="animate-spin" /> : null}
                  {parsing
                    ? "Uploading & parsing…"
                    : sowDocs.length > 0
                      ? "Upload & parse another"
                      : "Upload & parse SOW"}
                </GhostButton>
                {sowDocs.length === 0 && (
                  <button
                    type="button"
                    className="text-[13px] font-medium text-mute underline-offset-2 hover:text-ink hover:underline"
                    onClick={nextFromStep4}
                  >
                    Skip for now
                  </button>
                )}
              </div>

              {deliverables.length > 0 && (
                <>
                  <p className="text-[13px] font-medium text-ink">
                    {deliverables.length} deliverable{deliverables.length === 1 ? "" : "s"} across{" "}
                    {sowDocs.length} document{sowDocs.length === 1 ? "" : "s"} — confirm below
                    before continuing
                  </p>
                  {(() => {
                    const groups = new Map<string, { fileName: string; items: Deliverable[] }>();
                    for (const d of deliverables) {
                      if (!groups.has(d.sourceDocId)) {
                        groups.set(d.sourceDocId, { fileName: d.sourceFileName, items: [] });
                      }
                      groups.get(d.sourceDocId)!.items.push(d);
                    }
                    return Array.from(groups.entries()).map(([docId, group]) => (
                      <div key={docId} className="flex flex-col gap-2">
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-mute uppercase">
                          <FileText className="size-3 shrink-0" />
                          From: {group.fileName}
                        </div>
                        {group.items.map((d) => {
                          const i = deliverables.indexOf(d);
                          return (
                            <div key={d.id} className="flex items-center gap-2 pl-1">
                              <span className="w-7 shrink-0 text-[12px] font-semibold text-mute">
                                D{i + 1}
                              </span>
                              <Input
                                value={d.name}
                                onChange={(e) => updateDeliverable(d.id, "name", e.target.value)}
                                onBlur={() => persistDeliverableEdit(d)}
                                placeholder="Deliverable name"
                                className="flex-grow"
                              />
                              <Input
                                value={d.criteria}
                                onChange={(e) =>
                                  updateDeliverable(d.id, "criteria", e.target.value)
                                }
                                onBlur={() => persistDeliverableEdit(d)}
                                placeholder="Acceptance criteria"
                                className="flex-grow"
                              />
                              {d.sourcePage != null && (
                                <span
                                  className="shrink-0 text-[11px] text-mute"
                                  title="Source page in the SOW"
                                >
                                  p.{d.sourcePage}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => removeDeliverable(d.id)}
                                className="shrink-0 text-mute hover:text-danger"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ));
                  })()}
                  <GhostButton onClick={addDeliverableRow} className="w-fit">
                    <Plus /> Add deliverable row
                  </GhostButton>

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
