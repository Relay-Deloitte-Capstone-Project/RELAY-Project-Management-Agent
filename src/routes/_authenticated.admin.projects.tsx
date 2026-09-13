import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, Plus } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import { Chip, GhostButton, PageSection, Panel } from "@/components/relay/primitives";
import { ProjectDetailPanel } from "@/components/relay/ProjectDetailPanel";
import { cn } from "@/lib/utils";
import {
  SETUP_STEPS,
  completedStepCount,
  mockProjects,
  type MockProject,
  type ProjectStatus,
} from "@/lib/admin/mockProjects";

export const Route = createFileRoute("/_authenticated/admin/projects")({
  head: () => ({
    meta: [
      { title: "All projects — Relay" },
      { name: "description", content: "Every client engagement connected to Relay." },
      { property: "og:title", content: "All projects — Relay" },
      { property: "og:description", content: "Status, client and Jira key for every project." },
    ],
  }),
  component: AllProjects,
});

const statusDot: Record<ProjectStatus, string> = {
  active: "bg-success",
  setup: "bg-brand",
  archived: "bg-mute",
};

const statusBadge: Record<ProjectStatus, string> = {
  active: "bg-success-soft text-success",
  setup: "bg-warning-soft text-warning",
  archived: "bg-surface-sunken text-mute",
};

const statusLabel: Record<ProjectStatus, string> = {
  active: "Active",
  setup: "Setup in progress",
  archived: "Archived",
};

const STEP_LABEL: Record<(typeof SETUP_STEPS)[number], string> = {
  details: "Details",
  jira: "Jira",
  github: "GitHub",
  sow: "SOW",
  team: "Team",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function StatChip({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-surface-sunken px-2 py-0.75 text-[10px]">
      <span className="text-mute">{label}</span>
      <span className="font-semibold text-ink">{value}</span>
    </span>
  );
}

function AllProjects() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const projects = mockProjects;

  const [viewProject, setViewProject] = useState<MockProject | null>(null);

  // Both go to the real setup wizard route (backed by public.projects +
  // the SOW pipeline) — this used to open ProjectWizardDialog, a separate,
  // fully-mock duplicate of the same 5 steps that never reached the
  // backend. That dialog has been removed.
  function openNewProjectWizard() {
    navigate({ to: "/admin/projects/new" });
  }

  function openContinueSetup(id: string) {
    navigate({ to: "/admin/projects/new", search: { project: id } });
  }

  return (
    <AppShell user={user} title="All projects">
      <PageSection label="Projects" subtitle="Every client engagement connected to Relay.">
        <div className="mb-3 flex justify-end">
          <GhostButton tone="brand" onClick={openNewProjectWizard}>
            <Plus /> New project
          </GhostButton>
        </div>

        <Panel>
          <div className="flex flex-col">
            {projects.map((p) => {
              const done = completedStepCount(p.setupProgress);
              return (
                <div key={p.id} className="border-b border-border py-3.5 last:border-b-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span
                        className={cn("mt-1.5 size-2 shrink-0 rounded-full", statusDot[p.status])}
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-semibold text-ink">{p.name}</span>
                          {p.capstone && <Chip tone="violet">Capstone project</Chip>}
                        </div>
                        <div className="text-[11.5px] text-mute">
                          {p.clientName} · {p.jiraKey} · started {formatDate(p.startDate)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          "rounded-sm px-1.5 py-0.5 text-[11px] font-semibold",
                          statusBadge[p.status],
                        )}
                      >
                        {statusLabel[p.status]}
                      </span>
                      {p.status === "setup" ? (
                        <GhostButton tone="brand" onClick={() => openContinueSetup(p.id)}>
                          Continue setup →
                        </GhostButton>
                      ) : (
                        <GhostButton onClick={() => setViewProject(p)}>View →</GhostButton>
                      )}
                    </div>
                  </div>

                  {p.status === "active" && (
                    <div className="mt-2.5 pl-5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatChip label="Tickets" value={p.ticketCount.toLocaleString()} />
                          <StatChip label="Commits" value={p.commitCount.toLocaleString()} />
                          <StatChip label="Coverage" value={`${p.coveragePct}%`} />
                          <StatChip label="Team" value={p.memberCount} />
                        </div>
                        <span className="shrink-0 text-[10px] text-mute">
                          Last sync: {p.lastSync}
                        </span>
                      </div>
                      {p.capstone && (
                        <p className="mt-1.5 text-[10.5px] text-mute">
                          Syncing from KPD workboard · Jira Cloud Free
                        </p>
                      )}
                    </div>
                  )}

                  {p.status === "setup" && (
                    <div className="mt-2.5 flex items-center gap-3 pl-5">
                      <div className="flex flex-grow items-center gap-1">
                        {SETUP_STEPS.map((s) => {
                          const isDone = p.setupProgress[s];
                          return (
                            <div key={s} className="flex flex-grow flex-col items-center gap-1">
                              <span
                                className={cn(
                                  "flex h-4 w-full items-center justify-center rounded-full",
                                  isDone ? "bg-success" : "bg-surface-sunken",
                                )}
                                title={STEP_LABEL[s]}
                              >
                                {isDone && <Check className="size-2.5 text-white" />}
                              </span>
                              <span
                                className={cn(
                                  "text-[9.5px] font-medium tracking-wide uppercase",
                                  isDone ? "text-success" : "text-mute",
                                )}
                              >
                                {STEP_LABEL[s]}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <span className="shrink-0 text-[11px] font-semibold text-mute">
                        {done}/{SETUP_STEPS.length} steps complete · last updated {p.lastActivity}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      </PageSection>

      <ProjectDetailPanel project={viewProject} onClose={() => setViewProject(null)} />
    </AppShell>
  );
}
