import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Search,
  ShieldAlert,
  Ticket,
  XCircle,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import { Chip, PageSection, Panel, TicketKey } from "@/components/relay/primitives";
import { cachedJson } from "@/lib/relayApi";

const API = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

type Deliverable = {
  deliverable_key: string;
  deliverable_title: string;
  total_tickets: number;
  in_scope_count: number;
  compliance_percent: number;
};

type ScopeAlert = {
  id?: string | number;
  ticket_id?: string;
  ticket_summary?: string;
  deliverable_key?: string;
  status?: "out_of_scope" | "ambiguous" | string;
  clause?: string | null;
  reason?: string;
};

type ScopeTicket = {
  ticket_id: string;
  ticket_summary: string;
  epic_key: string;
  deliverable_key: string;
  status: "in_scope" | "out_of_scope" | "ambiguous" | string;
  clause?: string | null;
  reason?: string;
};

export const Route = createFileRoute("/_authenticated/mgr/scope")({
  head: () => ({
    meta: [
      { title: "Scope Guardian — Relay" },
      {
        name: "description",
        content: "Manager view of Jira work against the signed Statement of Work.",
      },
    ],
  }),
  component: ScopeGuardian,
});

const deliverableShortNames: Record<string, string> = {
  D1: "Data Ingestion",
  D2: "Ticket-to-Commit",
  D3: "Hybrid Search",
  D4: "Handover Brief",
  D5: "Scope Guardian",
  D6: "Provenance & Access",
  D7: "Secrets Scanning",
  D8: "Auto-Draft",
};

function classificationLabel(status: string) {
  if (status === "in_scope") return "In scope";
  if (status === "out_of_scope") return "Out of scope";
  return "Ambiguous";
}

function classificationTone(status: string): "success" | "warning" | "danger" {
  if (status === "in_scope") return "success";
  if (status === "out_of_scope") return "danger";
  return "warning";
}

function complianceTone(percent: number) {
  if (percent >= 80) return "text-success";
  if (percent >= 50) return "text-warning";
  return "text-danger";
}

// Bars carried the same green regardless of value, so a deliverable sitting at
// 0% compliance looked identical to one at 93%. Fill now tracks the label.
function complianceFill(percent: number) {
  if (percent >= 80) return "bg-success";
  if (percent >= 50) return "bg-warning";
  return "bg-danger";
}

function ScopeGuardian() {
  const { user } = Route.useRouteContext();

  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [alerts, setAlerts] = useState<ScopeAlert[]>([]);
  const [tickets, setTickets] = useState<ScopeTicket[]>([]);
  const [loading, setLoading] = useState(true);

  const [classificationFilter, setClassificationFilter] = useState("all");

  const [deliverableFilter, setDeliverableFilter] = useState("all");

  const [search, setSearch] = useState("");

  const [page, setPage] = useState(1);

  const PAGE_SIZE = 8;

  useEffect(() => {
    async function loadScopeData() {
      try {
        const [deliverablesData, alertsData] = await Promise.all([
          cachedJson<Deliverable[]>(`${API}/api/scope/deliverables`).catch(() => {
            throw new Error("Failed to load deliverables");
          }),
          cachedJson<ScopeAlert[]>(`${API}/api/scope/alerts`).catch(() => {
            throw new Error("Failed to load alerts");
          }),
        ]);

        setDeliverables(deliverablesData);
        setAlerts(alertsData);

        const ticketResults = await Promise.all(
          deliverablesData.map((d) =>
            cachedJson<ScopeTicket[]>(
              `${API}/api/scope/tickets/KPD-${d.deliverable_key.replace("D", "")}`,
            ).catch(() => [] as ScopeTicket[]),
          ),
        );

        setTickets(ticketResults.flat());
      } catch (error) {
        console.error("Failed to load Scope Guardian data:", error);
      } finally {
        setLoading(false);
      }
    }

    loadScopeData();
  }, []);

  const inScopeCount = tickets.filter((t) => t.status === "in_scope").length;

  const outOfScopeCount = tickets.filter((t) => t.status === "out_of_scope").length;

  const ambiguousCount = tickets.filter((t) => t.status === "ambiguous").length;

  const filteredTickets = useMemo(() => {
    const query = search.trim().toLowerCase();

    return tickets.filter((ticket) => {
      const matchesClassification =
        classificationFilter === "all" || ticket.status === classificationFilter;

      const matchesDeliverable =
        deliverableFilter === "all" || ticket.deliverable_key === deliverableFilter;

      const matchesSearch =
        !query ||
        ticket.ticket_id.toLowerCase().includes(query) ||
        ticket.ticket_summary.toLowerCase().includes(query) ||
        (ticket.reason ?? "").toLowerCase().includes(query);

      return matchesClassification && matchesDeliverable && matchesSearch;
    });
  }, [tickets, classificationFilter, deliverableFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredTickets.length / PAGE_SIZE));

  const visibleTickets = filteredTickets.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function changeFilter(value: string) {
    setClassificationFilter(value);
    setPage(1);
  }

  function changeDeliverable(value: string) {
    setDeliverableFilter(value);
    setPage(1);
  }

  function changeSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  const totalTickets = deliverables.reduce((sum, d) => sum + d.total_tickets, 0) || tickets.length;

  const scopePercent = totalTickets ? ((inScopeCount / totalTickets) * 100).toFixed(1) : "0.0";

  const outPercent = totalTickets ? ((outOfScopeCount / totalTickets) * 100).toFixed(1) : "0.0";

  const ambiguousPercent = totalTickets
    ? ((ambiguousCount / totalTickets) * 100).toFixed(1)
    : "0.0";

  const donutTotal = inScopeCount + outOfScopeCount + ambiguousCount || 1;

  const inDeg = (inScopeCount / donutTotal) * 360;
  const outDeg = (outOfScopeCount / donutTotal) * 360;

  const donutBackground = `conic-gradient(
    #22c55e 0deg ${inDeg}deg,
    #ef4444 ${inDeg}deg ${inDeg + outDeg}deg,
    #eab308 ${inDeg + outDeg}deg 360deg
  )`;

  return (
    <AppShell user={user} title="Scope guardian">
      <PageSection
        label="SOW: Arclight Continuity — Q3 2026 engagement"
        subtitle="Manager view · Jira work checked against contracted scope"
      >
        {/* HEADER */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Scope Guardian</h1>

            <p className="mt-1 text-[12px] text-mute">
              Quickly identify scope risk across all Jira deliverables.
            </p>
          </div>

          <div className="rounded-md border border-border bg-card px-3 py-2 text-right">
            <p className="text-[10px] uppercase tracking-wide text-mute">Last analysis</p>
            <p className="text-[12px] font-medium text-ink">Real Jira + PostgreSQL</p>
          </div>
        </div>

        {/* KPI CARDS */}
        <div className="mb-4 grid grid-cols-4 gap-3">
          <MetricCard
            icon={<Ticket className="size-4" />}
            label="Total Jira tickets"
            value={totalTickets}
            description="Across 8 deliverables"
            tone="brand"
          />

          <MetricCard
            icon={<CheckCircle2 className="size-4" />}
            label="In scope"
            value={inScopeCount}
            description={`${scopePercent}% of all tickets`}
            tone="success"
          />

          <MetricCard
            icon={<XCircle className="size-4" />}
            label="Out of scope"
            value={outOfScopeCount}
            description={`${outPercent}% require review`}
            tone="danger"
          />

          <MetricCard
            icon={<ShieldAlert className="size-4" />}
            label="Ambiguous"
            value={ambiguousCount}
            description={`${ambiguousPercent}% need confirmation`}
            tone="warning"
          />
        </div>

        {/* VISUAL OVERVIEW */}
        <div className="mb-4 grid grid-cols-[1fr_1.35fr_1fr] gap-3">
          {/* DONUT */}
          <Panel>
            <div className="mb-3">
              <h2 className="text-[14px] font-semibold text-ink">Scope distribution</h2>
              <p className="text-[11px] text-mute">Overall classification of Jira work</p>
            </div>

            <div className="flex items-center justify-center gap-5">
              <div
                className="relative flex size-[145px] items-center justify-center rounded-full"
                style={{
                  background: donutBackground,
                }}
              >
                <div className="flex size-[82px] flex-col items-center justify-center rounded-full bg-card">
                  <span className="text-xl font-semibold text-ink">{totalTickets}</span>
                  <span className="text-[10px] text-mute">Tickets</span>
                </div>
              </div>

              <div className="space-y-3">
                <LegendRow
                  label="In scope"
                  value={inScopeCount}
                  percent={scopePercent}
                  className="bg-success"
                />

                <LegendRow
                  label="Out of scope"
                  value={outOfScopeCount}
                  percent={outPercent}
                  className="bg-danger"
                />

                <LegendRow
                  label="Ambiguous"
                  value={ambiguousCount}
                  percent={ambiguousPercent}
                  className="bg-warning"
                />
              </div>
            </div>
          </Panel>

          {/* BAR GRAPH */}
          <Panel>
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h2 className="text-[14px] font-semibold text-ink">Compliance by deliverable</h2>

                <p className="text-[11px] text-mute">Percentage of tickets currently in scope</p>
              </div>

              <span className="rounded-md border border-border px-2 py-1 text-[10px] text-mute">
                D1–D8
              </span>
            </div>

            <div className="flex h-[180px] items-end gap-2">
              {deliverables.map((d) => (
                <div
                  key={d.deliverable_key}
                  className="flex min-w-0 flex-1 flex-col items-center justify-end"
                >
                  <span
                    className={`mb-1 text-[10px] font-semibold ${complianceTone(
                      d.compliance_percent,
                    )}`}
                  >
                    {d.compliance_percent.toFixed(1)}%
                  </span>

                  <div className="flex h-[125px] w-full items-end justify-center">
                    <div
                      className={`w-[65%] rounded-t-md opacity-80 transition-all hover:opacity-100 ${complianceFill(
                        d.compliance_percent,
                      )}`}
                      style={{
                        height: `${Math.max(d.compliance_percent, 2)}%`,
                      }}
                      title={`${d.deliverable_key}: ${d.compliance_percent}%`}
                    />
                  </div>

                  <span className="mt-2 font-mono text-[10px] font-semibold text-mute">
                    {d.deliverable_key}
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          {/* DELIVERABLE OVERVIEW */}
          <Panel>
            <div className="mb-3">
              <h2 className="text-[14px] font-semibold text-ink">Deliverable overview</h2>

              <p className="text-[11px] text-mute">Quick health check</p>
            </div>

            <div className="space-y-2">
              {deliverables.map((d) => (
                <div
                  key={d.deliverable_key}
                  className="grid grid-cols-[34px_1fr_45px] items-center gap-2"
                >
                  <span className="rounded-md bg-card px-1.5 py-1 text-center font-mono text-[10px] font-semibold text-brand">
                    {d.deliverable_key}
                  </span>

                  <div className="min-w-0">
                    <div className="flex justify-between gap-2">
                      <span className="truncate text-[10px] text-ink">
                        {deliverableShortNames[d.deliverable_key] ?? d.deliverable_title}
                      </span>

                      <span
                        className={`text-[10px] font-semibold ${complianceTone(
                          d.compliance_percent,
                        )}`}
                      >
                        {d.compliance_percent.toFixed(1)}%
                      </span>
                    </div>

                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border">
                      <div
                        className={`h-full rounded-full transition-all ${complianceFill(
                          d.compliance_percent,
                        )}`}
                        style={{
                          width: `${d.compliance_percent}%`,
                        }}
                      />
                    </div>
                  </div>

                  <span className="text-right text-[10px] text-mute">{d.total_tickets}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* TICKET SECTION */}
        <Panel>
          {/* FILTER HEADER */}
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[14px] font-semibold text-ink">Jira scope review</h2>

              <p className="text-[11px] text-mute">Select a classification to focus the review.</p>
            </div>

            <div className="relative w-[260px]">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-mute" />

              <input
                value={search}
                onChange={(e) => changeSearch(e.target.value)}
                placeholder="Search ticket..."
                className="h-8 w-full rounded-md border border-border bg-card pl-8 pr-3 text-[11px] text-ink outline-none placeholder:text-mute focus:border-brand"
              />
            </div>
          </div>

          {/* STATUS TABS */}
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex rounded-md border border-border bg-card p-0.5">
              <FilterButton
                active={classificationFilter === "all"}
                onClick={() => changeFilter("all")}
              >
                All tickets
              </FilterButton>

              <FilterButton
                active={classificationFilter === "in_scope"}
                onClick={() => changeFilter("in_scope")}
              >
                In scope
              </FilterButton>

              <FilterButton
                active={classificationFilter === "out_of_scope"}
                onClick={() => changeFilter("out_of_scope")}
              >
                Out of scope
              </FilterButton>

              <FilterButton
                active={classificationFilter === "ambiguous"}
                onClick={() => changeFilter("ambiguous")}
              >
                Ambiguous
              </FilterButton>
            </div>

            <select
              value={deliverableFilter}
              onChange={(e) => changeDeliverable(e.target.value)}
              className="h-8 rounded-md border border-border bg-card px-3 text-[11px] text-ink outline-none focus:border-brand"
            >
              <option value="all">All deliverables</option>

              {deliverables.map((d) => (
                <option key={d.deliverable_key} value={d.deliverable_key}>
                  {d.deliverable_key} —{" "}
                  {deliverableShortNames[d.deliverable_key] ?? d.deliverable_title}
                </option>
              ))}
            </select>
          </div>

          {/* TABLE */}
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border bg-card">
                  <th className="px-3 py-2 text-left section-label">Ticket</th>

                  <th className="px-3 py-2 text-left section-label">Summary</th>

                  <th className="px-3 py-2 text-left section-label">SOW</th>

                  <th className="px-3 py-2 text-left section-label">Classification</th>

                  <th className="px-3 py-2 text-left section-label">Reason</th>

                  <th className="px-3 py-2 text-left section-label">Evidence</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-[12px] text-mute">
                      Loading real Jira scope data...
                    </td>
                  </tr>
                ) : visibleTickets.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-[12px] text-mute">
                      No tickets match these filters.
                    </td>
                  </tr>
                ) : (
                  visibleTickets.map((ticket) => (
                    <tr
                      key={ticket.ticket_id}
                      className="border-b border-border last:border-b-0 hover:bg-card/60"
                    >
                      <td className="px-3 py-2 align-middle">
                        <TicketKey>{ticket.ticket_id}</TicketKey>
                      </td>

                      <td className="max-w-[300px] px-3 py-2">
                        <p className="whitespace-normal break-words text-[11px] leading-4 text-ink">
                          {ticket.ticket_summary}
                        </p>
                      </td>

                      <td className="px-3 py-2">
                        <span className="rounded-md bg-card px-2 py-1 font-mono text-[10px] font-semibold text-brand">
                          {ticket.deliverable_key}
                        </span>
                      </td>

                      <td className="px-3 py-2">
                        <select
                          value={
                            ticket.status === "in_scope" ||
                            ticket.status === "out_of_scope" ||
                            ticket.status === "ambiguous"
                              ? ticket.status
                              : "ambiguous"
                          }
                          onChange={(e) => {
                            const nextStatus = e.target.value;

                            setTickets((current) =>
                              current.map((item) =>
                                item.ticket_id === ticket.ticket_id
                                  ? {
                                      ...item,
                                      status: nextStatus,
                                    }
                                  : item,
                              ),
                            );
                          }}
                          className={`h-7 min-w-[112px] rounded-md border bg-card px-2 text-[10px] font-medium outline-none ${
                            ticket.status === "in_scope"
                              ? "border-success text-success"
                              : ticket.status === "out_of_scope"
                                ? "border-danger text-danger"
                                : "border-warning text-warning"
                          }`}
                        >
                          <option value="in_scope">In scope</option>

                          <option value="out_of_scope">Out of scope</option>

                          <option value="ambiguous">Ambiguous</option>
                        </select>
                      </td>

                      <td className="max-w-[260px] px-3 py-2">
                        <p className="whitespace-normal break-words text-[10px] leading-4 text-mute">
                          {ticket.reason || "No additional reasoning supplied."}
                        </p>
                      </td>

                      <td className="px-3 py-2">
                        {ticket.clause ? (
                          <div className="flex items-center gap-1.5 text-[10px] text-brand">
                            <FileText className="size-3" />
                            <span className="max-w-[180px] whitespace-normal break-words">
                              {ticket.clause}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[10px] text-mute">No clause</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* PAGINATION */}
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[10px] text-mute">
              Showing {filteredTickets.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–
              {Math.min(page * PAGE_SIZE, filteredTickets.length)} of {filteredTickets.length}{" "}
              tickets
            </span>

            <div className="flex items-center gap-1">
              <button
                disabled={page === 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="rounded-md border border-border px-2.5 py-1 text-[10px] text-mute disabled:opacity-40"
              >
                Previous
              </button>

              <span className="px-2 text-[10px] text-ink">
                {page} / {totalPages}
              </span>

              <button
                disabled={page >= totalPages}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                className="rounded-md border border-border px-2.5 py-1 text-[10px] text-mute disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </Panel>

        {/* SMALL ALERT SUMMARY */}
        <div className="mt-3 grid grid-cols-3 gap-3">
          <AlertSummary
            icon={<XCircle className="size-4" />}
            title="Out-of-scope work"
            value={outOfScopeCount}
            description="Requires PM review before delivery."
            tone="danger"
          />

          <AlertSummary
            icon={<AlertTriangle className="size-4" />}
            title="Ambiguous work"
            value={ambiguousCount}
            description="Needs human scope confirmation."
            tone="warning"
          />

          <AlertSummary
            icon={<CheckCircle2 className="size-4" />}
            title="In-scope work"
            value={inScopeCount}
            description="Aligned with the contracted SOW."
            tone="success"
          />
        </div>
      </PageSection>
    </AppShell>
  );
}

function MetricCard({
  icon,
  label,
  value,
  description,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  description: string;
  tone: "brand" | "success" | "danger" | "warning";
}) {
  const toneClass = {
    brand: "text-brand bg-brand/10",
    success: "text-success bg-success/10",
    danger: "text-danger bg-danger/10",
    warning: "text-warning bg-warning/10",
  }[tone];

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <div className={`flex size-8 items-center justify-center rounded-md ${toneClass}`}>
          {icon}
        </div>

        <span className="text-[10px] font-medium uppercase tracking-wide text-mute">{label}</span>
      </div>

      <p className="mt-2 text-2xl font-semibold text-ink">{value}</p>

      <p className="text-[10px] text-mute">{description}</p>
    </div>
  );
}

function LegendRow({
  label,
  value,
  percent,
  className,
}: {
  label: string;
  value: number;
  percent: string;
  className: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={`size-2.5 rounded-full ${className}`} />

      <div>
        <p className="text-[11px] text-ink">{label}</p>

        <p className="text-[10px] text-mute">
          {value} · {percent}%
        </p>
      </div>
    </div>
  );
}

function FilterButton({
  children,
  active,
  onClick,
}: {
  children: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-3 py-1.5 text-[10px] font-medium transition ${
        active ? "bg-brand text-white" : "text-mute hover:bg-card hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function AlertSummary({
  icon,
  title,
  value,
  description,
  tone,
}: {
  icon: ReactNode;
  title: string;
  value: number;
  description: string;
  tone: "success" | "danger" | "warning";
}) {
  const toneClass = {
    success: "text-success bg-success/10",
    danger: "text-danger bg-danger/10",
    warning: "text-warning bg-warning/10",
  }[tone];

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
      <div className={`flex size-8 shrink-0 items-center justify-center rounded-md ${toneClass}`}>
        {icon}
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-ink">{title}</span>

          <span className="font-mono text-[12px] font-semibold text-ink">{value}</span>
        </div>

        <p className="whitespace-normal break-words text-[10px] text-mute">{description}</p>
      </div>
    </div>
  );
}
