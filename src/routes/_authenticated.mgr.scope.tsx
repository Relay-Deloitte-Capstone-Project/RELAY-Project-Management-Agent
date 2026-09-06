import { createFileRoute } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { AppShell } from "@/components/relay/AppShell";
import { Chip, GhostButton, PageSection, Panel, TicketKey } from "@/components/relay/primitives";
import { scopeAlerts, scopeDeliverables } from "@/lib/mockData";
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
          "Every ticket checked against the signed SOW's deliverable boundaries, with out-of-scope and ambiguous work flagged automatically.",
      },
      { property: "og:title", content: "Scope guardian — Relay" },
      {
        property: "og:description",
        content: "SOW compliance by deliverable, plus recent scope alerts.",
      },
    ],
  }),
  component: ScopeGuardian,
});

const statusTone: Record<string, "success" | "warning" | "danger"> = {
  "On track": "success",
  "At risk": "warning",
  "Scope creep": "danger",
};

function ScopeGuardian() {
  const { user } = Route.useRouteContext();
  return (
    <AppShell user={user} title="Scope guardian">
      <PageSection
        label="SOW: Apache Kafka Q3 2026 engagement"
        subtitle="6 deliverables · Uploaded Aug 15"
      >
        <Panel>
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
              {scopeDeliverables.map((d) => (
                <TableRow key={d.key} className="h-10">
                  <TableCell className="text-[13px] text-ink">
                    <span className="font-mono text-[13px] font-semibold text-mute">{d.key}</span>{" "}
                    {d.title}
                  </TableCell>
                  <TableCell className="text-[13px] text-mute">{d.tickets}</TableCell>
                  <TableCell className="text-[13px] text-ink">{d.compliance}%</TableCell>
                  <TableCell>
                    <Chip tone={statusTone[d.status] ?? "neutral"}>{d.status}</Chip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      </PageSection>

      <PageSection label="Recent scope alerts">
        <div className="flex flex-col gap-3">
          {scopeAlerts.map((alert) => (
            <div
              key={alert.id}
              className={`rounded-r-lg border border-border bg-card p-4 ${
                alert.severity === "danger"
                  ? "border-l-[3px] border-l-danger"
                  : "border-l-[3px] border-l-warning"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Chip tone={alert.severity}>{alert.badge}</Chip>
                    <TicketKey>{alert.key}</TicketKey>
                    <span className="text-[13px] text-ink">{alert.title}</span>
                  </div>
                  <p className="mt-1.5 text-[11px] text-mute">{alert.detail}</p>
                </div>
                {alert.action ? (
                  <GhostButton tone="neutral">
                    <FileText /> {alert.action}
                  </GhostButton>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </PageSection>
    </AppShell>
  );
}
