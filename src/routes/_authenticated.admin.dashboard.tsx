import { createFileRoute } from "@tanstack/react-router";
import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import { GhostButton, PageSection, Panel, StatusDotCard } from "@/components/relay/primitives";
import { ingestionRuns } from "@/lib/mockData";
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

const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

type ServiceStatus = { label: string; value: string; tone: "success" | "warning" | "danger" | "neutral" | "brand" | "violet" };
type Summary = { total_issues: number; bug_rate: number };

function SystemHealth() {
  const { user } = Route.useRouteContext();
  const [services, setServices] = useState<ServiceStatus[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [servicesRes, summaryRes] = await Promise.all([
          fetch(`${API_URL}/api/project/services`),
          fetch(`${API_URL}/api/project/summary`),
        ]);
        if (!servicesRes.ok || !summaryRes.ok) throw new Error("Request failed");
        const [servicesJson, summaryJson] = await Promise.all([servicesRes.json(), summaryRes.json()]);
        if (!cancelled) {
          setServices(servicesJson);
          setSummary(summaryJson);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Couldn't load system health.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell user={user} title="System health">
      <PageSection label="Connections">
        {error && <p className="text-[13px] text-danger">{error}</p>}
        {!error && !services && (
          <div className="flex items-center gap-2 text-[13px] text-mute">
            <Loader2 className="size-3.5 animate-spin" /> Checking connections…
          </div>
        )}
        {services && (
          <div className="grid grid-cols-3 gap-3">
            {services.map((s) => (
              <StatusDotCard key={s.label} label={s.label} value={s.value} tone={s.tone} />
            ))}
          </div>
        )}
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

      <PageSection label="Quality">
        <Panel>
          {summary ? (
            <p className="text-[13px] leading-relaxed text-mute">
              <span className="font-semibold text-ink">{summary.bug_rate}% bug rate</span> across the KPD
              project — {summary.total_issues} tickets tracked in Jira.
            </p>
          ) : (
            <p className="text-[13px] text-mute">Loading…</p>
          )}
        </Panel>
      </PageSection>
    </AppShell>
  );
}
