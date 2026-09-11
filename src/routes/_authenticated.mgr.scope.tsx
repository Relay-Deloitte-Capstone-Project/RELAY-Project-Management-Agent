import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import { Chip, PageSection, Panel, TicketKey } from "@/components/relay/primitives";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/mgr/scope")({
  head: () => ({
    meta: [
      { title: "Scope guardian — Relay" },
      {
        name: "description",
        content:
          "Every ticket checked against real Jira scope labels, with out-of-scope and ambiguous work flagged automatically.",
      },
      { property: "og:title", content: "Scope guardian — Relay" },
      {
        property: "og:description",
        content: "Scope compliance by epic, plus recent scope alerts, from real Jira data.",
      },
    ],
  }),
  component: ScopeGuardian,
});

const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

function complianceStatus(pct: number): { label: string; tone: "success" | "warning" | "danger" } {
  if (pct >= 90) return { label: "On track", tone: "success" };
  if (pct >= 70) return { label: "At risk", tone: "warning" };
  return { label: "Scope creep", tone: "danger" };
}

type Epic = { key: string; title: string; ticket_count: number; scope_compliance_pct: number };
type Ticket = { key: string; summary: string };

function ScopeGuardian() {
  const { user } = Route.useRouteContext();
  const [epics, setEpics] = useState<Epic[] | null>(null);
  const [outOfScope, setOutOfScope] = useState<Ticket[] | null>(null);
  const [ambiguous, setAmbiguous] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [epicsRes, oosRes, ambRes] = await Promise.all([
          fetch(`${API_URL}/api/project/epics`),
          fetch(`${API_URL}/api/project/tickets?label=out-of-scope`),
          fetch(`${API_URL}/api/project/tickets?label=ambiguous`),
        ]);
        if (!epicsRes.ok || !oosRes.ok || !ambRes.ok) throw new Error("Request failed");
        const [epicsJson, oosJson, ambJson] = await Promise.all([epicsRes.json(), oosRes.json(), ambRes.json()]);
        if (!cancelled) {
          setEpics(epicsJson);
          setOutOfScope(oosJson);
          setAmbiguous(ambJson);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load scope data.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const alerts = [
    ...(outOfScope ?? []).map((t) => ({ ...t, severity: "danger" as const, badge: "Out of scope" })),
    ...(ambiguous ?? []).map((t) => ({ ...t, severity: "warning" as const, badge: "Ambiguous" })),
  ];

  return (
    <AppShell user={user} title="Scope guardian">
      <PageSection
        label="Relay-Deloitte Capstone"
        subtitle={epics ? `${epics.length} deliverables, mapped from real Jira epics` : "Loading…"}
      >
        <Panel>
          {error && <p className="p-3 text-[13px] text-danger">{error}</p>}
          {!epics && !error && (
            <div className="flex items-center gap-2 p-3 text-[13px] text-mute">
              <Loader2 className="size-3.5 animate-spin" /> Loading…
            </div>
          )}
          {epics && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="section-label">Deliverable</TableHead>
                  <TableHead className="section-label">Tickets</TableHead>
                  <TableHead className="section-label">Scope compliance</TableHead>
                  <TableHead className="section-label">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {epics.map((d) => {
                  const status = complianceStatus(d.scope_compliance_pct);
                  return (
                    <TableRow key={d.key} className="h-10">
                      <TableCell className="text-[13px] text-ink">
                        <span className="font-mono text-[13px] font-semibold text-mute">{d.key}</span>{" "}
                        {d.title}
                      </TableCell>
                      <TableCell className="text-[13px] text-mute">{d.ticket_count}</TableCell>
                      <TableCell className="text-[13px] text-ink">{d.scope_compliance_pct}%</TableCell>
                      <TableCell>
                        <Chip tone={status.tone}>{status.label}</Chip>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Panel>
      </PageSection>

      <PageSection label="Recent scope alerts">
        {alerts.length === 0 && (outOfScope || ambiguous) && (
          <p className="text-[13px] text-mute">No out-of-scope or ambiguous tickets right now.</p>
        )}
        <div className="flex flex-col gap-3">
          {alerts.map((alert) => (
            <div
              key={alert.key}
              className={`rounded-r-lg border border-border bg-card p-4 ${
                alert.severity === "danger" ? "border-l-[3px] border-l-danger" : "border-l-[3px] border-l-warning"
              }`}
            >
              <div className="flex items-center gap-2">
                <Chip tone={alert.severity}>{alert.badge}</Chip>
                <TicketKey>{alert.key}</TicketKey>
                <span className="text-[13px] text-ink">{alert.summary}</span>
              </div>
            </div>
          ))}
        </div>
      </PageSection>
    </AppShell>
  );
}
