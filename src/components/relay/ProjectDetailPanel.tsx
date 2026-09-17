import { Loader2, Save, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { GhostButton, SectionLabel } from "@/components/relay/primitives";
import { TeamRoster } from "@/components/relay/TeamRoster";
import { validateGithub, validateJira } from "@/lib/admin/validators";
import type { BackendProject } from "@/lib/admin/backendProjects";
import type { SessionUser } from "@/lib/auth/types";
import { relayFetch } from "@/lib/relayApi";

const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

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
      const res = await relayFetch(`${API_URL}/api/admin/projects/${project.engagement_id}/jira`, {
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
      const res = await relayFetch(`${API_URL}/api/admin/projects/${project.engagement_id}/github`, {
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
      const res = await relayFetch(`${API_URL}/api/admin/projects/${project.engagement_id}/governance`, {
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
                <TabsTrigger value="team">Team</TabsTrigger>
              </TabsList>

              <TabsContent value="connections" className="mt-4 flex flex-col gap-3">
                <SectionLabel>Jira &amp; GitHub</SectionLabel>
                <JiraEditor project={project} />
                <GithubEditor project={project} />
                <SectionLabel className="mt-2">Retention &amp; governance</SectionLabel>
                <GovernanceEditor project={project} />
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
