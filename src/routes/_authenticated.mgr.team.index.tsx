import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import { Avatar, PageSection, Panel } from "@/components/relay/primitives";
import { listTeamRoster } from "@/lib/team/functions";
import { teamMembers } from "@/lib/mockData";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/mgr/team/")({
  head: () => ({
    meta: [
      { title: "Team handover — Relay" },
      {
        name: "description",
        content:
          "Every team member's current work state, assembled from Jira, so handovers don't depend on someone's memory.",
      },
      { property: "og:title", content: "Team handover — Relay" },
      {
        property: "og:description",
        content: "Progress, tickets, code and chat usage per person.",
      },
    ],
  }),
  component: TeamHandover,
});

const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

type JiraMember = {
  account_id: string;
  name: string;
  email: string;
  to_do: number;
  in_progress: number;
  done: number;
};
type RosterEntry = {
  id: string;
  name: string;
  role: string;
  initials: string;
  avatarColor: string;
};
type ActivityEntry = {
  user_id: string;
  questions_asked: number;
  notes_captured: number;
  chat_usage_pct: number;
};
type Member = JiraMember & { role: string; initials: string; chatUsagePct: number | null };

function progressTone(pct: number) {
  if (pct >= 70) return "bg-success";
  if (pct >= 35) return "bg-brand";
  return "bg-warning";
}

function TeamHandover() {
  const { user } = Route.useRouteContext();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [jiraRes, activityRes, roster] = await Promise.all([
          fetch(`${API_URL}/api/project/team`),
          fetch(`${API_URL}/api/project/team-activity`),
          listTeamRoster(),
        ]);
        if (!jiraRes.ok) throw new Error("Request failed");
        const jiraTeam: JiraMember[] = await jiraRes.json();
        const activity: ActivityEntry[] = activityRes.ok ? await activityRes.json() : [];
        const activityByUserId = new Map(activity.map((a) => [a.user_id, a]));
        const rosterByName = new Map((roster as RosterEntry[]).map((r) => [r.name, r]));

        const joined = jiraTeam.map((m) => {
          const rosterEntry = rosterByName.get(m.name);
          const activityEntry = rosterEntry ? activityByUserId.get(rosterEntry.id) : undefined;
          return {
            ...m,
            role: rosterEntry?.role ?? "—",
            initials: rosterEntry?.initials ?? m.name.slice(0, 2).toUpperCase(),
            chatUsagePct: activityEntry?.chat_usage_pct ?? null,
          };
        });
        if (!cancelled) setMembers(joined);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load the team.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell user={user} title="Team handover">
      <PageSection
        label="Team overview"
        subtitle="Progress, tickets, code and chat usage — click any person for their full work state."
      >
        <Panel>
          {error && <p className="p-3 text-[13px] text-danger">{error}</p>}
          {!members && !error && (
            <div className="flex items-center gap-2 p-3 text-[13px] text-mute">
              <Loader2 className="size-3.5 animate-spin" /> Loading…
            </div>
          )}
          {members && (
            <ul>
              {members.map((member) => {
                const total = member.to_do + member.in_progress + member.done;
                const progressPct = total > 0 ? Math.round((member.done / total) * 100) : 0;
                const mockMember = teamMembers.find((m) => m.name === member.name);

                return (
                  <li key={member.account_id} className="border-b border-border last:border-0">
                    <Link
                      to="/mgr/team/$id"
                      params={{ id: member.account_id }}
                      className="flex items-center gap-4 py-3 transition-colors duration-150 hover:bg-surface-sunken"
                    >
                      <Avatar initials={member.initials} />
                      <span className="w-44 shrink-0">
                        <span className="block text-[13px] font-medium text-ink">
                          {member.name}
                        </span>
                        <span className="block text-[13px] text-mute">{member.role}</span>
                      </span>

                      <span className="w-32 shrink-0">
                        <span className="mb-1 flex items-center justify-between text-[11px] text-mute">
                          <span>Progress</span>
                          <span className="font-semibold text-ink">{progressPct}%</span>
                        </span>
                        <span className="block h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                          <span
                            className={cn("block h-full rounded-full", progressTone(progressPct))}
                            style={{ width: `${progressPct}%` }}
                          />
                        </span>
                      </span>

                      <span className="flex shrink-0 items-center gap-3 text-[12px] text-mute">
                        <span>
                          <span className="font-semibold text-ink">{member.to_do}</span> to do
                        </span>
                        <span>
                          <span className="font-semibold text-ink">{member.in_progress}</span> in
                          progress
                        </span>
                        <span>
                          <span className="font-semibold text-ink">{member.done}</span> done
                        </span>
                      </span>

                      <span className="w-24 shrink-0 text-[12px] text-mute">
                        {mockMember ? (
                          <>
                            <span className="font-semibold text-ink">{mockMember.prs}</span> PRs ·{" "}
                            <span className="font-semibold text-ink">{mockMember.reviews}</span>{" "}
                            reviews
                          </>
                        ) : (
                          "—"
                        )}
                      </span>

                      <span className="w-28 shrink-0">
                        <span className="mb-1 flex items-center justify-between text-[11px] text-mute">
                          <span>Chat usage</span>
                          <span className="font-semibold text-ink">
                            {member.chatUsagePct !== null ? `${member.chatUsagePct}%` : "—"}
                          </span>
                        </span>
                        <span className="block h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                          <span
                            className="block h-full rounded-full bg-brand"
                            style={{ width: `${member.chatUsagePct ?? 0}%` }}
                          />
                        </span>
                      </span>

                      <ChevronRight className="ml-auto size-3.5 shrink-0 text-mute" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </PageSection>

      <PageSection label="Why this works without a status meeting">
        <Panel>
          <p className="text-[13px] leading-relaxed text-mute">
            Progress and tickets come straight from Jira ticket status. Chat usage is each person's
            share of real questions asked in Ask Project — the same facts they'd see on their own My
            Work page. Nobody has to write a handover doc before going on leave.
          </p>
        </Panel>
      </PageSection>
    </AppShell>
  );
}
