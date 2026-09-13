import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, Github, Loader2, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import { GhostButton, PageSection, Panel } from "@/components/relay/primitives";
import { ProjectDetailPanel } from "@/components/relay/ProjectDetailPanel";
import { cn } from "@/lib/utils";
import {
  SETUP_STEPS,
  completedStepCount,
  deriveSetupProgress,
  fetchProjects,
  type BackendProject,
} from "@/lib/admin/backendProjects";

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

const statusDot: Record<BackendProject["status"], string> = {
  active: "bg-success",
  setup: "bg-brand",
  archived: "bg-mute",
};

const statusBadge: Record<BackendProject["status"], string> = {
  active: "bg-success-soft text-success",
  setup: "bg-warning-soft text-warning",
  archived: "bg-surface-sunken text-mute",
};

const statusLabel: Record<BackendProject["status"], string> = {
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

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ProjectCard({
  project: p,
  onContinueSetup,
  onView,
}: {
  project: BackendProject;
  onContinueSetup: () => void;
  onView: () => void;
}) {
  const progress = deriveSetupProgress(p);
  const done = completedStepCount(progress);

  return (
    <Panel className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", statusDot[p.status])} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[13px] font-semibold text-ink">{p.name}</span>
              {p.project_code && (
                <span className="shrink-0 rounded-sm bg-surface-sunken px-1 py-px font-mono text-[10px] font-semibold text-mute">
                  {p.project_code}
                </span>
              )}
            </div>
            <div className="truncate text-[11.5px] text-mute">{p.client_name}</div>
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] font-semibold",
            statusBadge[p.status],
          )}
        >
          {statusLabel[p.status]}
        </span>
      </div>

      <div className="flex items-center gap-3 text-[11px] text-mute">
        <span className="flex items-center gap-1">
          {p.jira_project_key ? (
            <Check className="size-3 text-success" />
          ) : (
            <X className="size-3 text-mute" />
          )}
          Jira{p.jira_project_key ? ` · ${p.jira_project_key}` : ""}
        </span>
        <span className="flex items-center gap-1">
          {p.github_repo_url ? (
            <Github className="size-3 text-success" />
          ) : (
            <Github className="size-3 text-mute" />
          )}
          GitHub{p.github_repo_url ? " · connected" : ""}
        </span>
        <span className="flex items-center gap-1">
          <Users className="size-3" />
          {p.member_count ?? 0} member{p.member_count === 1 ? "" : "s"}
        </span>
      </div>

      <div className="text-[11px] text-mute">Started {formatDate(p.start_date)}</div>

      {p.status === "setup" && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1">
            {SETUP_STEPS.map((s) => (
              <span
                key={s}
                title={STEP_LABEL[s]}
                className={cn(
                  "h-1.5 flex-grow rounded-full",
                  progress[s] ? "bg-success" : "bg-surface-sunken",
                )}
              />
            ))}
          </div>
          <span className="text-[10.5px] font-medium text-mute">
            {done}/{SETUP_STEPS.length} steps complete
          </span>
        </div>
      )}

      <div className="mt-auto pt-1">
        {p.status === "setup" ? (
          <GhostButton tone="brand" onClick={onContinueSetup} className="w-full justify-center">
            Continue setup →
          </GhostButton>
        ) : (
          <GhostButton onClick={onView} className="w-full justify-center">
            View →
          </GhostButton>
        )}
      </div>
    </Panel>
  );
}

function AllProjects() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();

  const [projects, setProjects] = useState<BackendProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewProject, setViewProject] = useState<BackendProject | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchProjects()
      .then((data) => {
        if (!cancelled) setProjects(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load projects");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function openContinueSetup(engagementId: string) {
    navigate({ to: "/admin/projects/new", search: { project: engagementId } });
  }

  return (
    <AppShell user={user} title="All projects">
      <PageSection
        label="Projects"
        subtitle="Every client engagement connected to Relay. Start a new one from Project setup."
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-mute">
            <Loader2 className="size-4 animate-spin" /> Loading projects…
          </div>
        ) : error ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-danger">
            <X className="size-4" /> {error}
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-[13px] text-mute">
            No projects yet — head to Project setup to create the first one.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <ProjectCard
                key={p.engagement_id}
                project={p}
                onContinueSetup={() => openContinueSetup(p.engagement_id)}
                onView={() => setViewProject(p)}
              />
            ))}
          </div>
        )}
      </PageSection>

      <ProjectDetailPanel project={viewProject} user={user} onClose={() => setViewProject(null)} />
    </AppShell>
  );
}
