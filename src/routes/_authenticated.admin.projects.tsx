import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import { GhostButton, PageSection, Panel } from "@/components/relay/primitives";
import {
  SETUP_STEPS,
  completedStepCount,
  mockProjects,
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

function AllProjects() {
  const { user } = Route.useRouteContext();
  const [projects] = useState(() => [...mockProjects]);

  return (
    <AppShell user={user} title="All projects">
      <PageSection label="Projects" subtitle="Every client engagement connected to Relay.">
        <div className="mb-3 flex justify-end">
          <Link to="/admin/projects/new">
            <GhostButton tone="brand">
              <Plus /> New project
            </GhostButton>
          </Link>
        </div>

        <Panel>
          <div className="flex flex-col">
            {projects.map((p) => {
              const done = completedStepCount(p.setupProgress);
              const pct = Math.round((done / SETUP_STEPS.length) * 100);
              return (
                <div key={p.id} className="border-b border-border py-3 last:border-b-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className={`size-2 shrink-0 rounded-full ${statusDot[p.status]}`} />
                      <div>
                        <div className="text-[13px] font-semibold text-ink">{p.name}</div>
                        <div className="text-[11.5px] text-mute">
                          {p.clientName} · {p.jiraKey} · started {formatDate(p.startDate)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`rounded-sm px-1.5 py-0.5 text-[11px] font-semibold ${statusBadge[p.status]}`}
                      >
                        {statusLabel[p.status]}
                      </span>
                      {p.status === "setup" ? (
                        <Link to="/admin/projects/new" search={{ project: p.id }}>
                          <GhostButton tone="brand">Continue setup</GhostButton>
                        </Link>
                      ) : (
                        <Link to="/admin/project-setup">
                          <GhostButton>View</GhostButton>
                        </Link>
                      )}
                    </div>
                  </div>

                  {p.status === "setup" && (
                    <div className="mt-2.5 flex items-center gap-3 pl-5">
                      <div className="flex flex-grow items-center gap-1">
                        {SETUP_STEPS.map((s) => (
                          <div key={s} className="flex flex-grow flex-col items-center gap-1">
                            <span
                              className={`h-1.5 w-full rounded-full ${p.setupProgress[s] ? "bg-success" : "bg-surface-sunken"}`}
                              title={STEP_LABEL[s]}
                            />
                            <span
                              className={`text-[9.5px] font-medium tracking-wide uppercase ${p.setupProgress[s] ? "text-success" : "text-mute"}`}
                            >
                              {STEP_LABEL[s]}
                            </span>
                          </div>
                        ))}
                      </div>
                      <span className="shrink-0 text-[11px] font-semibold text-mute">
                        {done}/{SETUP_STEPS.length} · {pct}% · {p.lastActivity}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      </PageSection>
    </AppShell>
  );
}
