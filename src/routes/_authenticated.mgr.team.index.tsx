import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, GitCommitHorizontal, Loader2, NotebookPen, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import { Avatar, Chip, MetricCard, PageSection, Panel } from "@/components/relay/primitives";
import { listTeamRoster } from "@/lib/team/functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/mgr/team/")({
  head: () => ({
    meta: [
      { title: "Team overview — Relay" },
      {
        name: "description",
        content:
          "Who is carrying what right now, and which in-flight work has nothing written down — assembled from Jira, GitHub and captured notes.",
      },
      { property: "og:title", content: "Team overview — Relay" },
      {
        property: "og:description",
        content: "Standing team continuity state, not a performance view.",
      },
    ],
  }),
  component: TeamOverview,
});

const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

// One row per person from /api/project/team-continuity — Jira load, real
// commit trail, captured-knowledge counts, and how much of their in-flight
// work has neither a note nor a linked commit behind it.
type ContinuityRow = {
  account_id: string;
  name: string;
  email: string | null;
  role: string | null;
  to_do: number;
  in_progress: number;
  done: number;
  commit_count: number;
  last_commit_at: string | null;
  notes_approved: number;
  // Count only — draft note *content* is never exposed to a manager, since a
  // draft belongs to the developer until they approve it.
  notes_draft: number;
  in_flight: number;
  undocumented_in_flight: number;
};
type RosterEntry = {
  id: string;
  name: string;
  role: string;
  initials: string;
  avatarColor: string;
};
// Ask Project usage, keyed by Prisma user id — the one thing here that
// isn't keyed by Jira name, so it's bridged through the roster (name -> id)
// client-side. The Python backend can't do that join itself: Prisma runs on
// a separate SQLite database it has no query access to.
type ActivityEntry = { user_id: string; questions_asked: number; chat_usage_pct: number };
type Member = ContinuityRow & { initials: string; chatUsagePct: number | null };

function relativeDays(iso: string | null): string {
  if (!iso) return "no commits";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

function TeamOverview() {
  const { user } = Route.useRouteContext();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [res, activityRes, roster] = await Promise.all([
          fetch(`${API_URL}/api/project/team-continuity`),
          fetch(`${API_URL}/api/project/team-activity`),
          listTeamRoster(),
        ]);
        if (!res.ok) throw new Error(`Couldn't load the team (${res.status})`);
        const rows: ContinuityRow[] = await res.json();
        const activity: ActivityEntry[] = activityRes.ok ? await activityRes.json() : [];
        const rosterByName = new Map((roster as RosterEntry[]).map((r) => [r.name, r]));
        const activityById = new Map(activity.map((a) => [a.user_id, a]));
        if (!cancelled) {
          setMembers(
            rows.map((r) => {
              const rosterEntry = rosterByName.get(r.name);
              return {
                ...r,
                initials:
                  rosterEntry?.initials ?? r.name.replace(/_/g, " ").slice(0, 2).toUpperCase(),
                chatUsagePct: rosterEntry
                  ? (activityById.get(rosterEntry.id)?.chat_usage_pct ?? null)
                  : null,
              };
            }),
          );
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load the team.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Managers and admins are already excluded server-side (HIDDEN_ROSTER_ROLES
  // in backend/api/project.py). This drops anyone left who has no assigned
  // work and no commits at all, so the list doesn't pad out with rows of
  // zeroes for people staffed but not yet active on the engagement.
  const active = members?.filter((m) => m.in_flight > 0 || m.commit_count > 0) ?? [];
  const totalInFlight = active.reduce((sum, m) => sum + m.in_flight, 0);
  const totalUndocumented = active.reduce((sum, m) => sum + m.undocumented_in_flight, 0);
  const totalNotes = active.reduce((sum, m) => sum + m.notes_approved, 0);

  return (
    <AppShell user={user} title="Team overview">
      <PageSection
        label="Continuity at a glance"
        subtitle="If someone went on leave tomorrow, how much of what they hold is written down anywhere?"
      >
        <div className="grid grid-cols-4 gap-3">
          <MetricCard label="People carrying work" value={members ? active.length : "—"} />
          <MetricCard label="Tickets in flight" value={members ? totalInFlight : "—"} tone="brand" />
          <MetricCard
            label="Nothing written down"
            value={members ? totalUndocumented : "—"}
            tone={totalUndocumented > 0 ? "warning" : "success"}
            hint="No note, no linked commit"
          />
          <MetricCard
            label="Knowledge notes kept"
            value={members ? totalNotes : "—"}
            tone="success"
            hint="Approved or promoted"
          />
        </div>
      </PageSection>

      <PageSection
        label="Team overview"
        subtitle="Click any person for their work state, code trail and captured knowledge."
      >
        <Panel>
          {error && <p className="p-3 text-[13px] text-danger">{error}</p>}
          {!members && !error && (
            <div className="flex items-center gap-2 p-3 text-[13px] text-mute">
              <Loader2 className="size-3.5 animate-spin" /> Loading…
            </div>
          )}
          {members && active.length === 0 && !error && (
            <p className="p-3 text-[13px] text-mute">
              Nobody on this engagement currently has assigned tickets or commits.
            </p>
          )}
          {members && active.length > 0 && (
            <ul>
              {active.map((member) => (
                <li key={member.account_id} className="border-b border-border last:border-0">
                  <Link
                    to="/mgr/team/$id"
                    params={{ id: member.account_id }}
                    className="flex items-center gap-4 py-3 transition-colors duration-150 hover:bg-surface-sunken"
                  >
                    <Avatar initials={member.initials} />
                    <span className="w-40 shrink-0">
                      <span className="block text-[13px] font-medium text-ink">
                        {member.name.replace(/_/g, " ")}
                      </span>
                      <span className="block text-[13px] text-mute">{member.role ?? "—"}</span>
                    </span>

                    <span className="flex w-36 shrink-0 items-center gap-1.5">
                      <Chip tone="brand">{member.in_progress} in flight</Chip>
                      <span className="text-[12px] text-mute">{member.to_do} queued</span>
                    </span>

                    <span className="w-32 shrink-0 text-[12px] text-mute">
                      <GitCommitHorizontal className="mr-1 inline size-3.5 -translate-y-px" />
                      <span className="font-semibold text-ink">{member.commit_count}</span> commits
                      <span className="block text-[11px]">{relativeDays(member.last_commit_at)}</span>
                    </span>

                    <span className="w-32 shrink-0 text-[12px] text-mute">
                      <NotebookPen className="mr-1 inline size-3.5 -translate-y-px" />
                      <span className="font-semibold text-ink">{member.notes_approved}</span> kept
                      {member.notes_draft > 0 && (
                        <span className="block text-[11px]">
                          {member.notes_draft} draft{member.notes_draft === 1 ? "" : "s"} pending
                        </span>
                      )}
                    </span>

                    {/* Share of all questions asked in Ask Project — a usage
                        signal, not a performance one: a low bar means someone
                        isn't leaning on the tool, not that they're behind. */}
                    <span className="w-24 shrink-0">
                      <span className="mb-1 flex items-center justify-between text-[11px] text-mute">
                        <span>Chat use</span>
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

                    {/* The signal this page exists for. It describes the
                        documentation state of work items, never the person —
                        the remedy is a note, not working faster. */}
                    <span className="ml-auto shrink-0">
                      {member.undocumented_in_flight > 0 ? (
                        <Chip tone={member.undocumented_in_flight > 2 ? "danger" : "warning"}>
                          <ShieldAlert className="size-3" />
                          {member.undocumented_in_flight} undocumented
                        </Chip>
                      ) : (
                        <Chip tone="success">All documented</Chip>
                      )}
                    </span>

                    <ChevronRight className="size-3.5 shrink-0 text-mute" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </PageSection>

      <PageSection label="How this is worked out">
        <Panel>
          <p className={cn("text-[13px] leading-relaxed text-mute")}>
            Tickets come from live Jira status. Commits come from the engagement&apos;s real GitHub
            history. A ticket counts as written down if a Scratchpad note was distilled from it or
            at least one commit references it — the two places reasoning is actually retained.
            Everything here describes work items, not people: there is no velocity, ranking or
            per-person schedule flag anywhere in Relay by design. Draft notes are counted but never
            shown to a manager, because a draft belongs to its author until they approve it.
          </p>
        </Panel>
      </PageSection>
    </AppShell>
  );
}
