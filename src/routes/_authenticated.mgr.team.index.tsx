import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { AppShell } from "@/components/relay/AppShell";
import { Avatar, Chip, PageSection, Panel } from "@/components/relay/primitives";
import { teamMembers } from "@/lib/mockData";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/mgr/team/")({
  head: () => ({
    meta: [
      { title: "Team handover — Relay" },
      {
        name: "description",
        content:
          "Every team member's current work state, assembled from Git and Jira, so handovers don't depend on someone's memory.",
      },
      { property: "og:title", content: "Team handover — Relay" },
      {
        property: "og:description",
        content: "Click any person to see their full work state.",
      },
    ],
  }),
  component: TeamHandover,
});

function TeamHandover() {
  const { user } = Route.useRouteContext();
  return (
    <AppShell user={user} title="Team handover">
      <PageSection label="Team overview" subtitle="Click any person to see their full work state.">
        <Panel>
          <ul>
            {teamMembers.map((member) => (
              <li key={member.id} className="border-b border-border last:border-0">
                <Link
                  to="/mgr/team/$id"
                  params={{ id: member.id }}
                  className="flex items-center gap-3 py-2.5 transition-colors duration-150 hover:bg-surface-sunken"
                >
                  <span className={cn(member.onLeave && "opacity-60")}>
                    <Avatar initials={member.initials} tone={member.tone} />
                  </span>
                  <span className={cn("w-44 shrink-0", member.onLeave && "[&>span]:opacity-60")}>
                    <span className="flex items-center gap-1.5">
                      <span className="block text-[13px] font-medium text-ink">{member.name}</span>
                      {member.onLeave ? <Chip tone="warning">On leave</Chip> : null}
                    </span>
                    <span className="block text-[13px] text-mute">{member.role}</span>
                  </span>
                  <span
                    className={cn(
                      "flex-grow text-[11px] text-mute",
                      member.onLeave && "opacity-60",
                    )}
                  >
                    Last commit {member.lastCommit}
                  </span>
                  <span
                    className={cn(
                      "flex shrink-0 items-center gap-4 text-[13px] text-mute",
                      member.onLeave && "opacity-60",
                    )}
                  >
                    <span>
                      <span className="font-semibold text-ink">{member.tickets}</span> tickets
                    </span>
                    <span>
                      <span className="font-semibold text-ink">{member.prs}</span> PRs
                    </span>
                    <span>
                      <span className="font-semibold text-ink">{member.reviews}</span> reviews
                    </span>
                  </span>
                  <ChevronRight
                    className={cn("size-3.5 text-mute", member.onLeave && "opacity-60")}
                  />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </PageSection>

      <PageSection label="Why this works without a status meeting">
        <Panel>
          <p className="text-[13px] leading-relaxed text-mute">
            Each brief is generated from open tickets, branches ahead of main and pending reviews —
            the same facts the person themselves would see on their own My Work page. Nobody has to
            write a handover doc before going on leave.
          </p>
        </Panel>
      </PageSection>
    </AppShell>
  );
}
