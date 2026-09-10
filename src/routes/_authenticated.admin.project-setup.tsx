import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import { GhostButton, MetricCard, PageSection, Panel } from "@/components/relay/primitives";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getMockProject, updateMockProject, type MockProject } from "@/lib/admin/mockProjects";

export const Route = createFileRoute("/_authenticated/admin/project-setup")({
  head: () => ({
    meta: [
      { title: "Project setup — Relay" },
      {
        name: "description",
        content: "Configuration and ingestion tracking for this project's connected sources.",
      },
      { property: "og:title", content: "Project setup — Relay" },
      { property: "og:description", content: "Project configuration and tracking metrics." },
    ],
  }),
  component: ProjectSetup,
});

const activityFeed: { label: string; time: string }[] = [
  { label: "Jira sync — 12 new tickets", time: "2h ago" },
  { label: "GitHub sync — 4 commits", time: "2h ago" },
  { label: "Secrets scan — clean", time: "2h ago" },
  { label: "Embeddings updated — 42 chunks", time: "2h ago" },
  { label: "Coverage recalculated — 62%", time: "3h ago" },
];

type FormState = {
  name: string;
  clientName: string;
  jiraKey: string;
  githubRepo: string;
  retentionDays: string;
  dpaReference: string;
};

function toForm(p: MockProject): FormState {
  return {
    name: p.name,
    clientName: p.clientName,
    jiraKey: p.jiraKey,
    githubRepo: p.githubRepo,
    retentionDays: p.retentionDays !== null ? String(p.retentionDays) : "",
    dpaReference: p.dpaReference,
  };
}

function ProjectSetup() {
  const { user } = Route.useRouteContext();
  const [project, setProject] = useState(() => getMockProject("kafka"));
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() =>
    project ? toForm(project) : toForm({} as MockProject),
  );
  const [saved, setSaved] = useState(false);

  if (!project) {
    return (
      <AppShell user={user} title="Project setup">
        <PageSection>
          <Panel>
            <p className="text-[13px] text-mute">Project not found.</p>
          </Panel>
        </PageSection>
      </AppShell>
    );
  }

  function openEdit() {
    setForm(toForm(project!));
    setSaved(false);
    setEditOpen(true);
  }

  function saveConfig() {
    const updated = updateMockProject("kafka", {
      name: form.name.trim() || project!.name,
      clientName: form.clientName.trim() || project!.clientName,
      jiraKey: form.jiraKey.trim().toUpperCase() || project!.jiraKey,
      githubRepo: form.githubRepo.trim() || project!.githubRepo,
      retentionDays: form.retentionDays.trim() === "" ? null : Number(form.retentionDays),
      dpaReference: form.dpaReference.trim() || project!.dpaReference,
      lastActivity: "just now",
    });
    if (updated) setProject({ ...updated });
    setSaved(true);
    window.setTimeout(() => setEditOpen(false), 700);
  }

  const configRows: { label: string; value: string }[] = [
    { label: "Project name", value: project.name },
    { label: "Client name", value: project.clientName },
    { label: "Jira key", value: project.jiraKey },
    { label: "GitHub repo", value: project.githubRepo },
    {
      label: "Retention policy",
      value: project.retentionDays !== null ? `${project.retentionDays} days` : "indefinite",
    },
    { label: "DPA reference", value: project.dpaReference },
  ];

  return (
    <AppShell user={user} title="Project setup">
      <PageSection
        label="Projects"
        subtitle="Every connected engagement and its ingestion configuration."
      >
        <div className="flex items-center justify-between">
          <div />
          <Link to="/admin/projects/new">
            <GhostButton tone="brand">
              <Plus /> Add new project
            </GhostButton>
          </Link>
        </div>
      </PageSection>

      <PageSection>
        <Panel
          title={project.name}
          icon={
            <span className="inline-flex items-center gap-1.5 rounded-sm bg-success-soft px-1.5 py-0.5 text-[11px] font-semibold text-success">
              <span className="size-1.5 rounded-full bg-success" /> Active
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="section-label">Configuration</h3>
                <GhostButton onClick={openEdit}>
                  <Pencil /> Edit configuration
                </GhostButton>
              </div>
              <div className="flex flex-col gap-2.5">
                {configRows.map((f) => (
                  <div key={f.label} className="flex items-center justify-between gap-3">
                    <span className="text-[13px] text-mute">{f.label}</span>
                    <span className="rounded-md bg-surface-sunken px-2.5 py-1 text-[13px] font-medium text-ink">
                      {f.value}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] text-mute">Ingestion status</span>
                  <span className="flex items-center gap-1.5 rounded-md bg-surface-sunken px-2.5 py-1 text-[13px] font-medium text-ink">
                    <span className="size-1.5 rounded-full bg-success" /> Active
                  </span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="section-label mb-3">Tracking</h3>
              <div className="grid grid-cols-2 gap-3">
                <MetricCard label="Total tickets" value="1,247" />
                <MetricCard label="Commits indexed" value="892" />
                <MetricCard label="Coverage" value="62%" tone="brand" />
                <MetricCard label="Chunks in DB" value="8,420" />
              </div>

              <h3 className="section-label mt-4 mb-2">Recent activity</h3>
              <div className="flex flex-col gap-1.5">
                {activityFeed.map((a, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3 rounded-lg bg-surface-sunken px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <Check className="size-3.5 shrink-0 text-success" />
                      <span className="text-[13px] text-ink">{a.label}</span>
                    </div>
                    <span className="shrink-0 text-[11px] text-mute">{a.time}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>
      </PageSection>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-[14px]">Edit configuration</DialogTitle>
            <DialogDescription className="text-[13px]">
              Changes apply immediately — no ingestion restart is needed for these fields.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="section-label">Project name</label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="section-label">Client name</label>
              <Input
                value={form.clientName}
                onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="section-label">Jira key</label>
              <Input
                value={form.jiraKey}
                onChange={(e) => setForm((f) => ({ ...f, jiraKey: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="section-label">GitHub repo</label>
              <Input
                value={form.githubRepo}
                onChange={(e) => setForm((f) => ({ ...f, githubRepo: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="section-label">Retention (days)</label>
              <Input
                type="number"
                value={form.retentionDays}
                onChange={(e) => setForm((f) => ({ ...f, retentionDays: e.target.value }))}
                placeholder="indefinite"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="section-label">DPA reference</label>
              <Input
                value={form.dpaReference}
                onChange={(e) => setForm((f) => ({ ...f, dpaReference: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <GhostButton onClick={() => setEditOpen(false)}>Cancel</GhostButton>
            <GhostButton tone="brand" onClick={saveConfig}>
              {saved ? (
                <>
                  <Check className="size-3.5" /> Saved
                </>
              ) : (
                "Save changes"
              )}
            </GhostButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
