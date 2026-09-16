import { createFileRoute, Link } from "@tanstack/react-router";
import { GitBranch, Inbox, ListChecks, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import {
  Chip,
  BranchName,
  MetricCard,
  Panel,
  PageSection,
  SkeletonRows,
  TicketKey,
} from "@/components/relay/primitives";
import { branches } from "@/lib/mockData";
import { useMyProject } from "@/lib/admin/useMyProject";

export const Route = createFileRoute("/_authenticated/dev/work")({
  head: () => ({
    meta: [
      { title: "My work — Relay" },
      {
        name: "description",
        content:
          "Your open tickets, active branches and pending reviews, assembled from Jira and Git in seconds.",
      },
      { property: "og:title", content: "My work — Relay" },
      {
        property: "og:description",
        content: "Open tickets, branches ahead of main and reviews waiting on you.",
      },
    ],
  }),
  component: MyWork,
});

const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";
const MS_PER_DAY = 1000 * 60 * 60 * 24;

type RecentKnowledge = {
  kind: "note" | "document";
  title: string;
  at: string | null;
  author: string | null;
  doc_type: string | null;
};

type UnassignedTicket = {
  ticket_key: string;
  summary: string;
  status: string;
  issue_type: string;
};

type Ticket = { key: string; summary: string; status: string; created: string };

function ageDays(created: string): number {
  return Math.floor((Date.now() - new Date(created).getTime()) / MS_PER_DAY);
}

function MyWork() {
  const { user } = Route.useRouteContext();
  const { project } = useMyProject(user.email);
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentKnowledge[] | null>(null);
  const [unassigned, setUnassigned] = useState<UnassignedTicket[] | null>(null);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    (async () => {
      try {
        const [recentRes, unassignedRes] = await Promise.all([
          fetch(
            `${API_URL}/api/project/recent-knowledge?engagement_id=${encodeURIComponent(project.engagement_id)}&limit=6`,
          ),
          fetch(`${API_URL}/api/project/unassigned-tickets?limit=6`),
        ]);
        if (!cancelled && recentRes.ok) setRecent(await recentRes.json());
        if (!cancelled && unassignedRes.ok) setUnassigned(await unassignedRes.json());
      } catch {
        // Both panels degrade to their own empty state — neither blocks the page.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project]);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({
          assignee: user.name,
          engagement_id: project.engagement_id,
          requester_email: user.email,
        });
        const res = await fetch(`${API_URL}/api/project/tickets?${params}`);
        if (!res.ok) throw new Error("Request failed");
        const json: Ticket[] = await res.json();
        if (!cancelled) setTickets(json);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Couldn't load your tickets.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project, user.name, user.email]);

  return (
    <AppShell user={user} title="My work">
      <PageSection label="Today">
        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="Open tickets" value={tickets?.length ?? "—"} tone="warning" />
          <MetricCard label="Open PRs" value={3} tone="brand" />
          <MetricCard
            label="Pending reviews"
            value={2}
            tone="danger"
            hint="Someone is waiting on you"
          />
        </div>
      </PageSection>

      <PageSection>
        <Panel title="Needs attention" icon={<TriangleAlert className="size-3.5 text-warning" />}>
          <ul>
            <li className="flex items-center gap-3 border-b border-border py-2">
              <TicketKey>KAFKA-16180</TicketKey>
              <span className="flex-grow text-[13px] text-ink">SASL auth token refresh loop</span>
              <Chip tone="danger">Critical</Chip>
              <span className="w-24 text-right text-[11px] text-mute">5 days stale</span>
            </li>
            <li className="flex items-center gap-3 py-2">
              <TicketKey>#16789</TicketKey>
              <span className="flex-grow text-[13px] text-ink">
                PR awaiting your review from Jun
              </span>
              <Chip tone="warning">Review</Chip>
              <span className="w-24 text-right text-[11px] text-mute">2 days</span>
            </li>
          </ul>
        </Panel>
      </PageSection>

      <PageSection>
        <div className="grid grid-cols-2 gap-4">
          <Panel title="Active branches" icon={<GitBranch className="size-3.5 text-mute" />}>
            <ul>
              {branches.map((b) => (
                <li key={b.name} className="border-b border-border py-2 last:border-0">
                  <BranchName>{b.name}</BranchName>
                  <div className="mt-0.5 text-[11px] text-mute">
                    {b.commitsAhead} commits ahead · last push {b.lastPush}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel
            title="Assigned tickets"
            icon={<ListChecks className="size-3.5 text-mute" />}
            action={
              <Link to="/dev/coverage" className="text-[13px] font-medium text-brand">
                {tickets && tickets.length > 6 ? `Show all ${tickets.length}` : "Show more"}
              </Link>
            }
          >
            {error && <p className="text-[13px] text-danger">{error}</p>}
            {!tickets && !error && (
              <SkeletonRows rows={4} className="py-2" />
            )}
            {tickets && tickets.length === 0 && (
              <p className="py-2 text-[13px] text-mute">No tickets assigned to you right now.</p>
            )}
            {tickets && tickets.length > 0 && (
              <ul>
                {[...tickets]
                  .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
                  .slice(0, 6)
                  .map((t) => (
                  <li
                    key={t.key}
                    className="flex items-center gap-3 border-b border-border py-2 last:border-0"
                  >
                    <TicketKey>{t.key}</TicketKey>
                    <span className="flex-grow truncate text-[13px] text-ink">{t.summary}</span>
                    <span className="text-[11px] text-mute">{ageDays(t.created)}d</span>
                    <Chip
                      tone={
                        t.status === "To Do"
                          ? "warning"
                          : t.status === "In Progress"
                            ? "brand"
                            : "success"
                      }
                    >
                      {t.status}
                    </Chip>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </PageSection>

      <PageSection label="Project knowledge">
        <div className="grid grid-cols-2 gap-4">
          <Panel
            title="Recently added knowledge"
            icon={<Sparkles className="size-3.5 text-highlight" />}
          >
            {!recent ? (
              <SkeletonRows rows={3} />
            ) : recent.length === 0 ? (
              <p className="text-[13px] text-mute">
                Nothing new has been captured for this project yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {recent.map((item) => (
                  <li key={`${item.kind}-${item.title}`} className="flex items-start gap-2.5">
                    <Chip tone={item.kind === "note" ? "brand" : "neutral"}>
                      {item.kind === "note" ? "Note" : (item.doc_type ?? "Doc").replace(/_/g, " ")}
                    </Chip>
                    <div className="min-w-0 flex-grow">
                      <p className="truncate text-[13px] text-ink">{item.title}</p>
                      <p className="text-[11px] text-mute">
                        {item.author}
                        {item.at ? ` · ${new Date(item.at).toLocaleDateString()}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Unclaimed work" icon={<Inbox className="size-3.5 text-mute" />}>
            {!unassigned ? (
              <SkeletonRows rows={3} />
            ) : unassigned.length === 0 ? (
              <p className="text-[13px] text-mute">Every open ticket has an owner right now.</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {unassigned.map((t) => (
                  <li key={t.ticket_key} className="flex items-start gap-2.5">
                    <TicketKey>{t.ticket_key}</TicketKey>
                    <div className="min-w-0 flex-grow">
                      <p className="truncate text-[13px] text-ink">{t.summary}</p>
                      <p className="text-[11px] text-mute">
                        {t.issue_type} · {t.status}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </PageSection>

      <PageSection label="Why this is trustworthy">
        <Panel>
          <p className="text-[13px] leading-relaxed text-mute">
            Ticket status comes straight from Jira, not from a manually updated board. It shows work{" "}
            <span className="font-medium text-ink">state</span>, never performance — and needs no
            approval to read.
          </p>
        </Panel>
      </PageSection>
    </AppShell>
  );
}
