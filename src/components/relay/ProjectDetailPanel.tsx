import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Avatar, GhostButton, SectionLabel } from "@/components/relay/primitives";
import type { MockProject } from "@/lib/admin/mockProjects";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ProjectDetailPanel({
  project,
  onClose,
}: {
  project: MockProject | null;
  onClose: () => void;
}) {
  const configToast = () =>
    toast("This would open the configuration editor in production.");

  return (
    <Sheet open={project !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-[480px] sm:max-w-[480px]">
        {project && (
          <div className="flex h-full flex-col">
            <SheetHeader>
              <SheetTitle className="text-[16px]">{project.name}</SheetTitle>
              <p className="text-[12px] text-mute">
                {project.clientName} · {project.jiraKey} · started {formatDate(project.startDate)}
              </p>
            </SheetHeader>

            <div className="mt-6 flex flex-col gap-6 overflow-y-auto">
              <div>
                <SectionLabel>Connection status</SectionLabel>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5">
                    <div className="flex items-center gap-2 text-[13px]">
                      <span className="w-12 shrink-0 font-semibold text-ink">Jira</span>
                      <span className="size-1.5 shrink-0 rounded-full bg-success" />
                      <span className="text-mute">Connected</span>
                      <span className="text-mute">
                        {project.jiraBaseUrl} · {project.jiraKey}
                      </span>
                    </div>
                    <GhostButton onClick={() => toast("Jira connection is healthy.")}>
                      Test
                    </GhostButton>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5">
                    <div className="flex items-center gap-2 text-[13px]">
                      <span className="w-12 shrink-0 font-semibold text-ink">GitHub</span>
                      <span className="size-1.5 shrink-0 rounded-full bg-success" />
                      <span className="text-mute">Connected</span>
                      <span className="truncate text-mute">github.com/{project.githubRepo}</span>
                    </div>
                    <GhostButton onClick={() => toast("GitHub connection is healthy.")}>
                      Test
                    </GhostButton>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5">
                    <div className="flex items-center gap-2 text-[13px]">
                      <span className="w-12 shrink-0 font-semibold text-ink">Last sync</span>
                      <span className="text-mute">{project.lastSync}</span>
                    </div>
                    <GhostButton
                      tone="brand"
                      onClick={() => toast(`Sync started for ${project.name}.`)}
                    >
                      <RefreshCw /> Sync now
                    </GhostButton>
                  </div>
                </div>
              </div>

              <div>
                <SectionLabel>Project stats</SectionLabel>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-surface-sunken px-3.5 py-3">
                    <div className="text-[20px] font-bold text-ink">
                      {project.ticketCount.toLocaleString()}
                    </div>
                    <div className="text-[11px] text-mute">tickets</div>
                  </div>
                  <div className="rounded-lg bg-surface-sunken px-3.5 py-3">
                    <div className="text-[20px] font-bold text-ink">
                      {project.commitCount.toLocaleString()}
                    </div>
                    <div className="text-[11px] text-mute">commits</div>
                  </div>
                  <div className="rounded-lg bg-surface-sunken px-3.5 py-3">
                    <div className="text-[20px] font-bold text-ink">{project.coveragePct}%</div>
                    <div className="text-[11px] text-mute">coverage</div>
                  </div>
                  <div className="rounded-lg bg-surface-sunken px-3.5 py-3">
                    <div className="text-[20px] font-bold text-ink">
                      {project.chunksCount.toLocaleString()}
                    </div>
                    <div className="text-[11px] text-mute">chunks</div>
                  </div>
                </div>
              </div>

              <div>
                <SectionLabel>Team members</SectionLabel>
                <div className="flex flex-col gap-2">
                  {project.team.slice(0, 4).map((m) => (
                    <div key={m.name} className="flex items-center gap-2.5">
                      <Avatar initials={m.initials} size={26} />
                      <span className="flex-grow text-[13px] text-ink">{m.name}</span>
                      <span className="text-[12px] text-mute">{m.role}</span>
                    </div>
                  ))}
                  {project.team.length > 4 && (
                    <p className="pl-[34px] text-[12px] text-mute">
                      + {project.team.length - 4} more
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-auto flex items-center gap-2 border-t border-border pt-4">
              <GhostButton onClick={configToast}>Edit configuration</GhostButton>
              <GhostButton tone="danger" onClick={configToast}>
                Begin offboarding
              </GhostButton>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
