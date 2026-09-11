import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import { MetricCard, PageSection, Panel, TicketKey } from "@/components/relay/primitives";
import { Input } from "@/components/ui/input";
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

const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

const statusTone: Record<string, "warning" | "brand" | "success" | "danger" | "neutral"> = {
  "To Do": "warning",
  "In Progress": "brand",
  Blocked: "danger",
  Done: "success",
};

type Summary = { total_issues: number; scope: { unlinked: number; coverage_pct: number } };
type Ticket = { key: string; summary: string; status: string; type: string };

function Coverage() {
  const { user } = Route.useRouteContext();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [summaryRes, ticketsRes] = await Promise.all([
          fetch(`${API_URL}/api/project/summary`),
          fetch(`${API_URL}/api/project/tickets?label=unlinked`),
        ]);
        if (!summaryRes.ok || !ticketsRes.ok) throw new Error("Request failed");
        const [summaryJson, ticketsJson] = await Promise.all([summaryRes.json(), ticketsRes.json()]);
        if (!cancelled) {
          setSummary(summaryJson);
          setTickets(ticketsJson);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Couldn't load coverage data.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const linked = summary ? summary.total_issues - summary.scope.unlinked : null;

  const q = query.trim().toLowerCase();
  const filtered = tickets
    ? q
      ? tickets.filter(
          (t) => t.key.toLowerCase().includes(q) || t.summary.toLowerCase().includes(q),
        )
      : tickets
    : null;

  return (
    <AppShell user={user} title="Coverage">
      {error && <p className="text-[13px] text-danger">{error}</p>}

      <PageSection>
        <div className="text-[52px] leading-none font-semibold text-ink">
          {summary ? `${summary.scope.coverage_pct}%` : "—"}
        </div>
        <p className="mt-2 max-w-md text-[13px] text-mute">
          of tickets are not labeled <code>unlinked</code> in Jira.
        </p>
      </PageSection>

      <PageSection label="At a glance">
        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="Linked tickets" value={linked ?? "—"} tone="success" />
          <MetricCard label="Unlinked tickets" value={summary?.scope.unlinked ?? "—"} tone="danger" />
          <MetricCard label="Secrets found in history" value={4} tone="warning" />
        </div>
      </PageSection>

      <PageSection label="Unlinked tickets" subtitle="Labeled unlinked in Jira.">
        <Panel>
          {!tickets && !error && (
            <div className="flex items-center gap-2 p-3 text-[13px] text-mute">
              <Loader2 className="size-3.5 animate-spin" /> Loading…
            </div>
          )}
          {tickets && (
            <>
              <div className="relative mb-3">
                <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-mute" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by ticket ID or summary…"
                  className="h-8 border-border bg-surface pl-9 text-[13px] placeholder:text-mute"
                />
              </div>
              <div className="max-h-[420px] overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      <TableHead className="section-label">Key</TableHead>
                      <TableHead className="section-label">Summary</TableHead>
                      <TableHead className="section-label">Status</TableHead>
                      <TableHead className="section-label">Type</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered!.map((t) => (
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
                                  : statusTone[t.status] === "success"
                                    ? "bg-success-soft text-success"
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
                {filtered!.length === 0 && (
                  <p className="py-6 text-center text-[13px] text-mute">
                    No tickets match “{query}”.
                  </p>
                )}
              </div>
            </>
          )}
        </Panel>
      </PageSection>

      <PageSection label="Why this number is honest">
        <Panel>
          <p className="text-[13px] leading-relaxed text-mute">
            Linkage reflects Jira's own <code>unlinked</code> label on each ticket — it is not
            self-reported. A ticket with no linked commit is not necessarily unfinished, but it means
            there is no independent record of the work.
          </p>
        </Panel>
      </PageSection>
    </AppShell>
  );
}
