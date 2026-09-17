import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  GitCommitHorizontal,
  Loader2,
  NotebookPen,
  Search,
  ShieldAlert,
  Zap,
} from "lucide-react";
import { AppShell } from "@/components/relay/AppShell";
import {
  Avatar,
  Chip,
  MetricCard,
  PageSection,
  Panel,
  TicketKey,
} from "@/components/relay/primitives";
import { Input } from "@/components/ui/input";
import { cachedJson } from "@/lib/relayApi";

export const Route = createFileRoute("/_authenticated/mgr/team/$id")({
  head: () => ({
    meta: [
      { title: "Work state — Relay" },
      {
        name: "description",
        content:
          "One person's live work state, code trail and captured knowledge, assembled from Jira and GitHub.",
      },
    ],
  }),
  component: TeamMemberProfile,
});

const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

// Assigning tickets and writing the handover note deliberately do NOT live
// here — that flow is the Handover kit, reached from the sidebar, and having
// a second copy of it on this page meant two implementations of the same
// thing where only one was backed by real data. This page answers the
// standing question instead: what is this person carrying, and what of it is
// written down anywhere?
//
// Managers and admins never appear here: /api/project/team-continuity
// excludes them (see HIDDEN_ROSTER_ROLES in backend/api/project.py), so a
// direct link to one resolves to the "no one matches this link" branch
// rather than rendering a profile.
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
  notes_draft: number;
  in_flight: number;
  undocumented_in_flight: number;
};
type Ticket = { key: string; summary: string; status: string; created: string };
type Commit = {
  sha_short: string;
  message: string;
  committed_at: string | null;
  repo: string | null;
  ticket_refs: string[];
};
type Trail = { name: string; email: string | null; commits: Commit[] };

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function TeamMemberProfile() {
  const { user } = Route.useRouteContext();
  const { id } = Route.useParams();

  const [team, setTeam] = useState<ContinuityRow[] | null>(null);
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [trail, setTrail] = useState<Trail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const member = team?.find((m) => m.account_id === id);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const json = await cachedJson<ContinuityRow[]>(`${API_URL}/api/project/team-continuity`);
        if (!cancelled) setTeam(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load the team.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!member) return;
    let cancelled = false;
    const name = member.name;
    (async () => {
      const [ticketsResult, trailResult] = await Promise.allSettled([
        cachedJson<Ticket[]>(`${API_URL}/api/project/tickets?assignee=${encodeURIComponent(name)}`),
        cachedJson<Trail>(`${API_URL}/api/project/member-trail?name=${encodeURIComponent(name)}`),
      ]);
      if (cancelled) return;
      if (ticketsResult.status === "fulfilled") setTickets(ticketsResult.value);
      if (trailResult.status === "fulfilled") setTrail(trailResult.value);
    })().catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load their work.");
    });
    return () => {
      cancelled = true;
    };
  }, [member?.name]);

  if (error) {
    return (
      <AppShell user={user} title="Work state">
        <PageSection>
          <p className="text-[13px] text-danger">{error}</p>
        </PageSection>
      </AppShell>
    );
  }

  if (!team) {
    return (
      <AppShell user={user} title="Work state">
        <PageSection>
          <div className="flex items-center gap-2 text-[13px] text-mute">
            <Loader2 className="size-3.5 animate-spin" /> Loading…
          </div>
        </PageSection>
      </AppShell>
    );
  }

  if (!member) {
    return (
      <AppShell user={user} title="Work state">
        <PageSection>
          <Panel>
            <p className="text-[13px] text-mute">No one on the team matches this link.</p>
          </Panel>
        </PageSection>
      </AppShell>
    );
  }

  const displayName = member.name.replace(/_/g, " ");
  const firstName = displayName.split(" ")[0] ?? displayName;
  const q = query.trim().toLowerCase();
  // Longest-outstanding first; live-filtered by key or summary.
  const visibleTickets = tickets
    ? [...tickets]
        .sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime())
        .filter((t) => !q || t.key.toLowerCase().includes(q) || t.summary.toLowerCase().includes(q))
    : null;

  return (
    <AppShell user={user} title={`${displayName} — work state`}>
      <PageSection>
        <Link to="/mgr/team" className="text-[13px] font-medium text-brand">
          ← Team overview
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Avatar initials={displayName.slice(0, 2).toUpperCase()} size={44} />
            <div>
              <h2 className="text-[16px] font-medium text-ink">{displayName}</h2>
              <p className="text-[13px] text-mute">
                {member.role ?? "Team member"}
                {member.email ? ` · ${member.email}` : ""}
              </p>
            </div>
          </div>
        </div>
      </PageSection>

      <PageSection>
        <div className="grid grid-cols-4 gap-3">
          <MetricCard label="In flight" value={member.in_progress} tone="brand" />
          <MetricCard label="Queued" value={member.to_do} />
          <MetricCard label="Done" value={member.done} tone="success" />
          <MetricCard
            label="Nothing written down"
            value={member.undocumented_in_flight}
            tone={member.undocumented_in_flight > 0 ? "warning" : "success"}
            hint="Of the in-flight work"
          />
        </div>
      </PageSection>

      <PageSection>
        <div className="grid grid-cols-2 gap-4">
          <Panel title="Open tickets" icon={<Zap className="size-3.5 text-mute" />}>
            {!tickets ? (
              <div className="flex items-center gap-2 py-2 text-[13px] text-mute">
                <Loader2 className="size-3.5 animate-spin" /> Loading…
              </div>
            ) : (
              <>
                <div className="relative mb-2">
                  <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-mute" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by ticket ID or summary…"
                    className="h-8 border-border bg-surface pl-9 text-[13px] placeholder:text-mute"
                  />
                </div>
                <div className="max-h-[360px] overflow-y-auto">
                  {tickets.length === 0 ? (
                    <p className="py-2 text-[13px] text-mute">No open tickets assigned.</p>
                  ) : visibleTickets!.length === 0 ? (
                    <p className="py-2 text-[13px] text-mute">No tickets match “{query}”.</p>
                  ) : (
                    <ul>
                      {visibleTickets!.map((t) => (
                        <li key={t.key} className="border-b border-border py-2 last:border-0">
                          <div className="flex items-center gap-2">
                            <TicketKey>{t.key}</TicketKey>
                            <span className="flex-grow text-[13px] text-ink">{t.summary}</span>
                            <Chip
                              tone={
                                t.status === "Done"
                                  ? "success"
                                  : t.status === "In Progress"
                                    ? "brand"
                                    : "neutral"
                              }
                            >
                              {t.status}
                            </Chip>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </Panel>

          <Panel
            title="Knowledge captured"
            icon={<NotebookPen className="size-3.5 text-mute" />}
          >
            <div className="flex gap-3">
              <div className="flex-1 rounded-lg bg-surface-sunken px-3 py-2.5">
                <div className="text-[22px] font-bold text-success">{member.notes_approved}</div>
                <div className="text-[11px] text-mute">Kept — approved or promoted</div>
              </div>
              <div className="flex-1 rounded-lg bg-surface-sunken px-3 py-2.5">
                <div className="text-[22px] font-bold text-ink">{member.notes_draft}</div>
                <div className="text-[11px] text-mute">Drafts pending review</div>
              </div>
            </div>
            {/* Counts only, deliberately. A Scratchpad draft belongs to its
                author until they approve it, so the content of an unapproved
                note is never surfaced to a manager. */}
            <p className="mt-3 text-[12px] leading-relaxed text-mute">
              Notes {firstName} approved are kept even if this client&apos;s data is later deleted.
              Draft contents stay private to {firstName} until approved — only the count is shown
              here.
            </p>
            {member.undocumented_in_flight > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2">
                <ShieldAlert className="mt-px size-3.5 shrink-0 text-warning" />
                <p className="text-[12px] leading-relaxed text-warning">
                  {member.undocumented_in_flight} in-flight ticket
                  {member.undocumented_in_flight === 1 ? " has" : "s have"} no note and no linked
                  commit — that reasoning exists nowhere but with {firstName}.
                </p>
              </div>
            )}
          </Panel>
        </div>
      </PageSection>

      <PageSection
        label="Code trail"
        subtitle="Real commits from this engagement's GitHub history, with the tickets each one references."
      >
        <Panel>
          {!trail ? (
            <div className="flex items-center gap-2 py-2 text-[13px] text-mute">
              <Loader2 className="size-3.5 animate-spin" /> Loading…
            </div>
          ) : trail.commits.length === 0 ? (
            <p className="py-2 text-[13px] text-mute">
              No commits recorded for {firstName} in this engagement.
            </p>
          ) : (
            <ul>
              {trail.commits.map((c) => (
                <li
                  key={c.sha_short}
                  className="flex items-center gap-3 border-b border-border py-2 last:border-0"
                >
                  <GitCommitHorizontal className="size-3.5 shrink-0 text-mute" />
                  <span className="font-mono text-[12px] text-brand">{c.sha_short}</span>
                  <span className="flex-grow text-[13px] text-ink">{c.message}</span>
                  {c.ticket_refs.map((ref) => (
                    <TicketKey key={ref}>{ref}</TicketKey>
                  ))}
                  <span className="w-16 shrink-0 text-right text-[11px] text-mute">
                    {formatDate(c.committed_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </PageSection>
    </AppShell>
  );
}
