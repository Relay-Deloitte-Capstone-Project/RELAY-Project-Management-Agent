import { createFileRoute, Link } from "@tanstack/react-router";
import { GitBranch, ListChecks, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/relay/AppShell";
import {
  Chip,
  BranchName,
  MetricCard,
  Panel,
  PageSection,
  TicketKey,
} from "@/components/relay/primitives";
import { branches, tickets } from "@/lib/mockData";

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

function MyWork() {
  const { user } = Route.useRouteContext();
  return (
    <AppShell user={user} title="My work">
      <PageSection label="Today">
        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="Open tickets" value={7} tone="warning" />
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
                Show more
              </Link>
            }
          >
            <ul>
              {tickets.map((t) => (
                <li
                  key={t.key}
                  className="flex items-center gap-3 border-b border-border py-2 last:border-0"
                >
                  <TicketKey>{t.key}</TicketKey>
                  <span className="flex-grow truncate text-[13px] text-ink">{t.summary}</span>
                  <Chip
                    tone={
                      t.status === "Open"
                        ? "warning"
                        : t.status === "In review"
                          ? "brand"
                          : "success"
                    }
                  >
                    {t.status}
                  </Chip>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </PageSection>

      <PageSection label="Why this is trustworthy">
        <Panel>
          <p className="text-[13px] leading-relaxed text-mute">
            This view is assembled from Git, not from a manually updated board. You cannot ship code
            without committing, so the commit record is always current. It shows work{" "}
            <span className="font-medium text-ink">state</span>, never performance — and needs no
            approval to read.
          </p>
        </Panel>
      </PageSection>
    </AppShell>
  );
}
