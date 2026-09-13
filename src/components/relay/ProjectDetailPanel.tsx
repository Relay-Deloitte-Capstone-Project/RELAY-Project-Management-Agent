import { FileText, Loader2, Save, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { GhostButton, SectionLabel } from "@/components/relay/primitives";
import { TeamRoster } from "@/components/relay/TeamRoster";
import { validateGithub, validateJira } from "@/lib/admin/validators";
import type { BackendProject } from "@/lib/admin/backendProjects";
import type { SessionUser } from "@/lib/auth/types";

const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

type SowDeliverable = {
  id: string;
  sequence: number;
  name: string;
  acceptance_criteria: string | null;
  source_page: number | null;
};

type SowDocument = {
  id: string;
  file_name: string;
  status: "uploaded" | "parsing" | "parsed" | "failed";
  parse_error?: string | null;
  deliverables: SowDeliverable[];
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function JiraEditor({ project }: { project: BackendProject }) {
  const [baseUrl, setBaseUrl] = useState(project.jira_base_url ?? "");
  const [projectKey, setProjectKey] = useState(project.jira_project_key ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    // Same format-only check as the setup wizard — this isn't a live Jira
    // call, just catching an obviously wrong URL/key before it's saved.
    const msg = validateJira({
      baseUrl,
      projectKey,
      email: "placeholder@example.com",
      apiToken: "x",
    });
    if (msg) {
      setError(msg);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/projects/${project.engagement_id}/jira`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_url: baseUrl, project_key: projectKey.toUpperCase() }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      toast("Jira connection saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-[12px] font-semibold text-ink">Jira</span>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://yourcompany.atlassian.net"
          className="flex-grow"
        />
        <Input
          value={projectKey}
          onChange={(e) => setProjectKey(e.target.value)}
          placeholder="KAN"
          className="w-24"
        />
        <GhostButton tone="brand" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save
        </GhostButton>
      </div>
      {error && (
        <span className="flex items-center gap-1.5 pl-16 text-[12px] font-medium text-danger">
          <X className="size-3 shrink-0" /> {error}
        </span>
      )}
    </div>
  );
}

function GithubEditor({ project }: { project: BackendProject }) {
  const [repoUrl, setRepoUrl] = useState(project.github_repo_url ?? "");
  const [branch, setBranch] = useState(project.github_branch ?? "main");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const msg = validateGithub({ repoUrl, token: "x" });
    if (msg) {
      setError(msg);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/projects/${project.engagement_id}/github`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_url: repoUrl, branch: branch || "main" }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      toast("GitHub connection saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-[12px] font-semibold text-ink">GitHub</span>
        <Input
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="https://github.com/owner/repo"
          className="flex-grow"
        />
        <Input
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="main"
          className="w-24"
        />
        <GhostButton tone="brand" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save
        </GhostButton>
      </div>
      {error && (
        <span className="flex items-center gap-1.5 pl-16 text-[12px] font-medium text-danger">
          <X className="size-3 shrink-0" /> {error}
        </span>
      )}
    </div>
  );
}

function GovernanceEditor({ project }: { project: BackendProject }) {
  const [retentionDays, setRetentionDays] = useState(String(project.retention_days ?? ""));
  const [dpaReference, setDpaReference] = useState(project.dpa_reference ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/projects/${project.engagement_id}/governance`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          retention_days: retentionDays ? Number(retentionDays) : null,
          dpa_reference: dpaReference || null,
        }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      toast("Retention settings saved.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border p-3">
      <span className="w-14 shrink-0 text-[12px] font-semibold text-ink">Retention</span>
      <Input
        type="number"
        value={retentionDays}
        onChange={(e) => setRetentionDays(e.target.value)}
        placeholder="Days"
        className="w-24"
      />
      <Input
        value={dpaReference}
        onChange={(e) => setDpaReference(e.target.value)}
        placeholder="DPA reference"
        className="flex-grow"
      />
      <GhostButton tone="brand" onClick={save} disabled={saving}>
        {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
        Save
      </GhostButton>
    </div>
  );
}

function DeliverablesTab({
  engagementId,
  uploadedBy,
}: {
  engagementId: string;
  uploadedBy: string;
}) {
  const [docs, setDocs] = useState<SowDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function loadDocs() {
    return fetch(`${API_URL}/api/admin/sow?engagement_id=${engagementId}&include_deliverables=true`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: SowDocument[]) => setDocs(data));
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadDocs()
      .catch(() => {
        // Empty list renders as the "No SOWs uploaded yet" state either way.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagementId]);

  async function uploadSow() {
    if (!file) return;
    setParsing(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("engagement_id", engagementId);
      form.append("uploaded_by", uploadedBy);

      const res = await fetch(`${API_URL}/api/admin/sow/upload`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Upload failed (${res.status})`);
      }
      await loadDocs();
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      toast("SOW uploaded and parsed.");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setParsing(false);
    }
  }

  async function removeDoc(docId: string) {
    setDocs((prev) => prev.filter((d) => d.id !== docId));
    try {
      await fetch(`${API_URL}/api/admin/sow/${docId}`, { method: "DELETE" });
    } catch {
      // Best-effort — it's already gone from this view either way.
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <SectionLabel>Upload a statement of work</SectionLabel>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setUploadError(null);
          }}
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-grow items-center gap-2.5 rounded-lg border border-dashed border-border px-4 py-3 text-[13px] text-mute hover:border-brand hover:text-ink"
          >
            {file ? (
              <>
                <FileText className="size-4 shrink-0" />
                <span className="truncate font-medium text-ink">{file.name}</span>
                <span className="shrink-0 text-mute">({(file.size / 1024).toFixed(0)} KB)</span>
              </>
            ) : (
              <>
                <Upload className="size-4 shrink-0" />
                Click to choose a PDF
              </>
            )}
          </button>
          <GhostButton tone="brand" onClick={uploadSow} disabled={!file || parsing}>
            {parsing ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {parsing ? "Uploading & parsing…" : "Upload & parse"}
          </GhostButton>
        </div>
        {uploadError && (
          <span className="flex items-center gap-1.5 text-[12px] font-medium text-danger">
            <X className="size-3 shrink-0" /> {uploadError}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-mute">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : docs.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-mute">No SOWs uploaded yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {docs.map((doc) => (
            <div key={doc.id} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="truncate text-[13px] font-semibold text-ink">{doc.file_name}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={
                      doc.status === "parsed"
                        ? "text-[11px] font-medium text-success"
                        : doc.status === "failed"
                          ? "text-[11px] font-medium text-danger"
                          : "text-[11px] font-medium text-mute"
                    }
                    title={doc.status === "failed" ? (doc.parse_error ?? undefined) : undefined}
                  >
                    {doc.status}
                  </span>
                  {doc.status === "failed" && (
                    <button
                      type="button"
                      onClick={() => removeDoc(doc.id)}
                      className="text-mute hover:text-danger"
                      title="Remove and retry"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              </div>
              {doc.deliverables.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {doc.deliverables.map((d) => (
                    <div key={d.id} className="rounded-md bg-surface-sunken px-2.5 py-1.5">
                      <span className="mr-1.5 text-[11px] font-semibold text-mute">
                        D{d.sequence}
                      </span>
                      <span className="text-[12.5px] text-ink">{d.name}</span>
                      {d.acceptance_criteria && (
                        <p className="mt-0.5 text-[11.5px] text-mute">{d.acceptance_criteria}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-mute">
                  {doc.status === "failed"
                    ? (doc.parse_error ?? "Parsing failed.")
                    : doc.status === "parsing"
                      ? "Parsing…"
                      : "No deliverables extracted."}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProjectDetailPanel({
  project,
  user,
  onClose,
}: {
  project: BackendProject | null;
  user: SessionUser;
  onClose: () => void;
}) {
  return (
    <Dialog open={project !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        {project && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <DialogTitle className="text-[16px]">{project.name}</DialogTitle>
                {project.project_code && (
                  <span className="rounded-sm bg-surface-sunken px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-mute">
                    {project.project_code}
                  </span>
                )}
              </div>
              <p className="text-[12px] text-mute">
                {project.client_name} · started {formatDate(project.start_date)}
              </p>
            </DialogHeader>

            <Tabs defaultValue="connections" className="mt-2">
              <TabsList>
                <TabsTrigger value="connections">Connections</TabsTrigger>
                <TabsTrigger value="deliverables">Deliverables</TabsTrigger>
                <TabsTrigger value="team">Team</TabsTrigger>
              </TabsList>

              <TabsContent value="connections" className="mt-4 flex flex-col gap-3">
                <SectionLabel>Jira &amp; GitHub</SectionLabel>
                <JiraEditor project={project} />
                <GithubEditor project={project} />
                <SectionLabel className="mt-2">Retention &amp; governance</SectionLabel>
                <GovernanceEditor project={project} />
              </TabsContent>

              <TabsContent value="deliverables" className="mt-4">
                <DeliverablesTab
                  engagementId={project.engagement_id}
                  uploadedBy={user.email || user.name}
                />
              </TabsContent>

              <TabsContent value="team" className="mt-4">
                <TeamRoster engagementId={project.engagement_id} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
