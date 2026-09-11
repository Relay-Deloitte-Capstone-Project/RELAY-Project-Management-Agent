import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import { GhostButton, PageSection, Panel } from "@/components/relay/primitives";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { mockIngestionLogs, mockProjects, type IngestionLogLevel } from "@/lib/admin/mockProjects";
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

const levelStyle: Record<IngestionLogLevel, string> = {
  info: "bg-surface-sunken text-mute",
  warn: "bg-warning-soft text-warning",
  error: "bg-danger-soft text-danger",
};

const levelSymbol: Record<IngestionLogLevel, string> = {
  info: "✓",
  warn: "⚠",
  error: "✗",
};

const FILTERS = ["All", "Info", "Warnings", "Errors"] as const;

function IngestionLogs() {
  const { user } = Route.useRouteContext();
  const [projectId, setProjectId] = useState(mockProjects[0]?.id ?? "kafka");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [autoRefresh, setAutoRefresh] = useState(false);

  const logs = useMemo(() => {
    return mockIngestionLogs
      .filter((l) => l.projectId === projectId)
      .filter((l) => {
        if (filter === "All") return true;
        if (filter === "Info") return l.level === "info";
        if (filter === "Warnings") return l.level === "warn";
        return l.level === "error";
      });
  }, [projectId, filter]);

  return (
    <AppShell user={user} title="Ingestion logs">
      <PageSection label="Run history">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="h-8 w-48 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {mockProjects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors duration-150",
                    filter === f
                      ? "bg-brand text-brand-foreground"
                      : "bg-surface-sunken text-mute hover:text-ink",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-1.5 text-[12px] text-mute">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="size-3.5 rounded-sm border-border"
            />
            Auto-refresh every 30s
          </label>
        </div>

        <Panel
          title="Log stream"
          action={
            <GhostButton>
              <RefreshCw /> Re-ingest
            </GhostButton>
          }
        >
          {logs.length === 0 ? (
            <p className="p-3 text-[13px] text-mute">No log entries match this filter.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="section-label">Time</TableHead>
                  <TableHead className="section-label">Source</TableHead>
                  <TableHead className="section-label">Message</TableHead>
                  <TableHead className="section-label">Level</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((l) => (
                  <TableRow key={l.id} className="h-10">
                    <TableCell className="font-mono text-[12.5px] text-mute">
                      {l.timestamp}
                    </TableCell>
                    <TableCell className="text-[12.5px] font-semibold text-ink">
                      {l.source}
                    </TableCell>
                    <TableCell className="text-[13px] text-mute">{l.message}</TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-semibold",
                          levelStyle[l.level],
                        )}
                      >
                        {levelSymbol[l.level]} {l.level}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
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
