import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { AppShell } from "@/components/relay/AppShell";
import { GhostButton, PageSection, Panel } from "@/components/relay/primitives";
import { ingestionRuns } from "@/lib/mockData";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/admin/ingestion")({
  head: () => ({
    meta: [
      { title: "Ingestion logs — Relay" },
      {
        name: "description",
        content: "Full ingestion run history for every connected data source.",
      },
      { property: "og:title", content: "Ingestion logs — Relay" },
      { property: "og:description", content: "Records ingested, duration and status per run." },
    ],
  }),
  component: IngestionLogs,
});

function IngestionLogs() {
  const { user } = Route.useRouteContext();
  return (
    <AppShell user={user} title="Ingestion logs">
      <PageSection label="Run history">
        <Panel
          title="All sources"
          action={
            <GhostButton>
              <RefreshCw /> Re-ingest all
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

      <PageSection label="Retention">
        <Panel>
          <p className="text-[13px] leading-relaxed text-mute">
            Ingestion logs are kept for 90 days. Raw source payloads are discarded after indexing —
            only extracted text, embeddings and provenance (ticket key, commit SHA, file path) are
            retained.
          </p>
        </Panel>
      </PageSection>
    </AppShell>
  );
}
