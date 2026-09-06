import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/relay/AppShell";
import { MetricCard, PageSection, Panel, TicketKey } from "@/components/relay/primitives";
import { unlinkedTickets } from "@/lib/mockData";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/dev/coverage")({
  head: () => ({
    meta: [
      { title: "Coverage — Relay" },
      {
        name: "description",
        content:
          "How much of this project's ticket history is actually backed by a linked commit, and where the gaps and leaked secrets are.",
      },
      { property: "og:title", content: "Coverage — Relay" },
      {
        property: "og:description",
        content: "Ticket-to-commit linkage, unlinked tickets and secrets found in history.",
      },
    ],
  }),
  component: Coverage,
});

const statusTone: Record<string, "warning" | "brand" | "success" | "danger" | "neutral"> = {
  Open: "warning",
  "In progress": "brand",
  Blocked: "danger",
  Complete: "success",
};

function Coverage() {
  const { user } = Route.useRouteContext();
  return (
    <AppShell user={user} title="Coverage">
      <PageSection>
        <div className="text-[52px] leading-none font-semibold text-ink">62%</div>
        <p className="mt-2 max-w-md text-[13px] text-mute">
          of tickets have at least one linked commit.
        </p>
      </PageSection>

      <PageSection label="At a glance">
        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="Linked tickets" value={776} tone="success" />
          <MetricCard label="Unlinked tickets" value={340} tone="danger" />
          <MetricCard label="Secrets found in history" value={4} tone="warning" />
        </div>
      </PageSection>

      <PageSection label="Unlinked tickets" subtitle="No commit references this ticket key.">
        <Panel>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="section-label">Key</TableHead>
                <TableHead className="section-label">Summary</TableHead>
                <TableHead className="section-label">Status</TableHead>
                <TableHead className="section-label">Type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unlinkedTickets.map((t) => (
                <TableRow key={t.key} className="h-10">
                  <TableCell>
                    <TicketKey>{t.key}</TicketKey>
                  </TableCell>
                  <TableCell className="text-[13px] text-ink">{t.summary}</TableCell>
                  <TableCell>
                    <span
                      className={`rounded-sm px-1.5 py-0.5 text-[11px] font-semibold ${
                        statusTone[t.status] === "danger"
                          ? "bg-danger-soft text-danger"
                          : statusTone[t.status] === "brand"
                            ? "bg-brand-soft text-brand"
                            : "bg-warning-soft text-warning"
                      }`}
                    >
                      {t.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-[13px] text-mute">{t.type}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      </PageSection>

      <PageSection label="Why this number is honest">
        <Panel>
          <p className="text-[13px] leading-relaxed text-mute">
            Linkage is detected from commit messages and PR descriptions referencing a ticket key —
            it is not self-reported. A ticket with no linked commit is not necessarily unfinished,
            but it means there is no independent record of the work.
          </p>
        </Panel>
      </PageSection>
    </AppShell>
  );
}
