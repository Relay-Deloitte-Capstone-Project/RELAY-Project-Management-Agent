import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { AppShell } from "@/components/relay/AppShell";
import { GhostButton, PageSection, Panel, StatusDotCard } from "@/components/relay/primitives";
import { ingestionRuns, systemServices } from "@/lib/mockData";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/admin/dashboard")({
  head: () => ({
    meta: [
      { title: "System health — Relay" },
      {
        name: "description",
        content:
          "Connection status for every data source and the last ingestion run for this project.",
      },
      { property: "og:title", content: "System health — Relay" },
      {
        property: "og:description",
        content: "Database, MCP and model connection status plus ingestion run history.",
      },
    ],
  }),
  component: SystemHealth,
});

function SystemHealth() {
  const { user } = Route.useRouteContext();
  return (
    <AppShell user={user} title="System health">
      <PageSection label="Connections">
        <div className="grid grid-cols-4 gap-3">
          {systemServices.map((s) => (
            <StatusDotCard key={s.label} label={s.label} value={s.value} tone={s.tone} />
          ))}
        </div>
      </PageSection>

      <PageSection label="Last ingestion run">
        <Panel
          title="Ingestion runs"
          action={
            <GhostButton>
              <RefreshCw /> Re-ingest
            </GhostButton>
          }
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="section-label">Source</TableHead>
                <TableHead className="section-label">Records</TableHead>
                <TableHead className="section-label">Duration</TableHead>
                <TableHead className="section-label">Status</TableHead>
                <TableHead className="section-label">Last run</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ingestionRuns.map((run) => (
                <TableRow key={run.source} className="h-10">
                  <TableCell className="text-[13px] text-ink">{run.source}</TableCell>
                  <TableCell className="text-[13px] text-mute">{run.records}</TableCell>
                  <TableCell className="text-[13px] text-mute">{run.duration}</TableCell>
                  <TableCell>
                    <span className="rounded-sm bg-success-soft px-1.5 py-0.5 text-[11px] font-semibold text-success">
                      {run.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-[13px] text-mute">{run.lastRun}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      </PageSection>

      <PageSection label="Coverage">
        <Panel>
          <p className="text-[13px] leading-relaxed text-mute">
            61.8% ticket-to-commit linkage — 123 of 199 tracked tickets.
          </p>
        </Panel>
      </PageSection>
    </AppShell>
  );
}
