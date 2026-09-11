import { createFileRoute } from "@tanstack/react-router";
import { History, Shield, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import { EmployeeBreakdown } from "@/components/relay/EmployeeBreakdown";
import { MetricCard, PageSection, Panel, ProgressRow } from "@/components/relay/primitives";
import { SprintBurndown } from "@/components/relay/SprintBurndown";
import { weeklyActivity as mockWeeklyActivity } from "@/lib/mockData";

const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

type SprintSummary = { id: number; name: string; state: "active" | "closed" | "future"; start: string; end: string };

const sprintStateTone: Record<SprintSummary["state"], string> = {
  active: "bg-success-soft text-success",
  closed: "bg-surface-sunken text-mute",
  future: "bg-warning-soft text-warning",
};

export const Route = createFileRoute("/_authenticated/mgr/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Relay" },
      {
        name: "description",
        content:
          "Team-level overview: open tickets, ticket coverage, scope health and risk signals for the engagement.",
      },
      { property: "og:title", content: "Dashboard — Relay" },
      {
        property: "og:description",
        content: "Scope health, risk signals and weekly activity for the whole team.",
      },
    ],
  }),
  component: ManagerDashboard,
});

const riskTone: Record<"high" | "medium" | "low", { bg: string; text: string }> = {
  high: { bg: "bg-danger-soft", text: "text-danger" },
  medium: { bg: "bg-warning-soft", text: "text-warning" },
  low: { bg: "bg-success-soft", text: "text-success" },
};

type Summary = {
  total_issues: number;
  by_status: Record<string, number>;
  scope: {
    in_scope: number;
    out_of_scope: number;
    ambiguous: number;
    unlinked: number;
    coverage_pct: number;
  };
};
type RiskSignal = { level: "high" | "medium" | "low"; title: string; detail: string };
type Activity = { questions_asked: number; notes_captured: number; tickets_closed_this_week: number | null };
type SprintHistoryEntry = { id: number; name: string; state: string; completion_pct: number | null };

function ManagerDashboard() {
  const { user } = Route.useRouteContext();
  const [sprints, setSprints] = useState<SprintSummary[] | null>(null);
  const [selectedSprintId, setSelectedSprintId] = useState<number | null>(null);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [teamCount, setTeamCount] = useState<number | null>(null);
  const [riskSignals, setRiskSignals] = useState<RiskSignal[] | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [sprintHistory, setSprintHistory] = useState<SprintHistoryEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/analytics/sprints`);
        if (!res.ok) return;
        const json: SprintSummary[] = await res.json();
        if (cancelled) return;
        setSprints(json);
        setSelectedSprintId((current) => current ?? json.find((s) => s.state === "active")?.id ?? json[0]?.id ?? null);
      } catch {
        // Sprint selector just won't render — the two panels below still
        // fall back to the active sprint on their own.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [summaryRes, teamRes, riskRes, activityRes, historyRes] = await Promise.all([
          fetch(`${API_URL}/api/project/summary`),
          fetch(`${API_URL}/api/project/team`),
          fetch(`${API_URL}/api/project/risk-signals`),
          fetch(`${API_URL}/api/project/activity`),
          fetch(`${API_URL}/api/project/sprint-history`),
        ]);
        if (cancelled) return;
        if (summaryRes.ok) setSummary(await summaryRes.json());
        if (teamRes.ok) setTeamCount((await teamRes.json()).length);
        if (riskRes.ok) setRiskSignals(await riskRes.json());
        if (activityRes.ok) setActivity(await activityRes.json());
        if (historyRes.ok) setSprintHistory(await historyRes.json());
      } catch {
        // Each panel below renders its own "—" placeholder when its slice
        // of this didn't load — no single blocking error state needed.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const scopeAlerts = summary ? summary.scope.out_of_scope + summary.scope.ambiguous : null;
  const openTickets = summary ? summary.total_issues - (summary.by_status["Done"] ?? 0) : null;

  const scopeRows = summary
    ? [
        { label: "In-scope tickets", value: Math.round((summary.scope.in_scope / summary.total_issues) * 100), tone: "success" as const },
        { label: "Out-of-scope", value: Math.round((summary.scope.out_of_scope / summary.total_issues) * 100), tone: "danger" as const },
        { label: "Ambiguous", value: Math.round((summary.scope.ambiguous / summary.total_issues) * 100), tone: "warning" as const },
      ]
    : [];

  return (
    <AppShell user={user} title="Dashboard">
      <PageSection label="Team">
        <div className="grid grid-cols-4 gap-3">
          <MetricCard label="Team members" value={teamCount ?? "—"} />
          <MetricCard label="Open tickets" value={openTickets ?? "—"} tone="warning" />
          <MetricCard label="Ticket coverage" value={summary ? `${summary.scope.coverage_pct}%` : "—"} tone="brand" />
          <MetricCard label="Scope alerts" value={scopeAlerts ?? "—"} tone="danger" />
        </div>
      </PageSection>

      <PageSection label="Sprint">
        {sprints && sprints.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {sprints.map((sprint) => (
              <button
                key={sprint.id}
                type="button"
                onClick={() => setSelectedSprintId(sprint.id)}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors duration-150 ${
                  selectedSprintId === sprint.id
                    ? "bg-brand text-brand-foreground"
                    : "bg-surface-sunken text-mute hover:text-ink"
                }`}
              >
                {sprint.name}
                <span
                  className={`rounded-full px-1.5 py-px text-[10px] uppercase tracking-wide ${
                    selectedSprintId === sprint.id ? "bg-brand-foreground/20 text-brand-foreground" : sprintStateTone[sprint.state]
                  }`}
                >
                  {sprint.state}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <SprintBurndown sprintId={selectedSprintId ?? undefined} />
          <EmployeeBreakdown sprintId={selectedSprintId ?? undefined} />
        </div>
      </PageSection>

      <PageSection>
        <Panel title="Sprint history" icon={<History className="size-3.5 text-mute" />}>
          {!sprintHistory ? (
            <p className="text-[13px] text-mute">Loading…</p>
          ) : (
            <div className="flex flex-col gap-2">
              {sprintHistory.map((s) => (
                <div key={s.id} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 truncate text-[12px] text-mute">{s.name}</span>
                  <div className="h-1.5 flex-grow overflow-hidden rounded-full bg-surface-sunken">
                    {s.completion_pct !== null && (
                      <div
                        className={`h-full rounded-full ${s.state === "active" ? "bg-brand" : "bg-success"}`}
                        style={{ width: `${s.completion_pct}%` }}
                      />
                    )}
                  </div>
                  <span className="w-16 shrink-0 text-right text-[12px] text-mute">
                    {s.completion_pct !== null ? `${s.completion_pct}%` : "not started"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </PageSection>

      <PageSection>
        <div className="grid grid-cols-2 gap-4">
          <Panel title="Scope health" icon={<Shield className="size-3.5 text-mute" />}>
            {scopeRows.length === 0 ? (
              <p className="text-[13px] text-mute">Loading…</p>
            ) : (
              scopeRows.map((row) => (
                <ProgressRow key={row.label} label={row.label} value={row.value} tone={row.tone} inline />
              ))
            )}
          </Panel>

          <Panel title="Risk signals" icon={<TriangleAlert className="size-3.5 text-mute" />}>
            <div className="flex flex-col gap-2">
              {!riskSignals && <p className="text-[13px] text-mute">Loading…</p>}
              {riskSignals?.length === 0 && <p className="text-[13px] text-mute">No risk signals right now.</p>}
              {riskSignals?.map((risk) => (
                <div key={risk.title} className={`rounded-lg px-3 py-2 ${riskTone[risk.level].bg}`}>
                  <p className={`text-[13px] font-medium ${riskTone[risk.level].text}`}>
                    {risk.title}
                  </p>
                  <p className="mt-0.5 text-[11px] text-mute">{risk.detail}</p>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </PageSection>

      <PageSection
        label="This week"
        subtitle="Tickets closed reflects this project's seed data, not sustained weekly velocity."
      >
        <div className="grid grid-cols-4 gap-3">
          <MetricCard label="Tickets closed" value={activity?.tickets_closed_this_week ?? "—"} />
          <MetricCard label="PRs merged" value={mockWeeklyActivity[1]?.value ?? "—"} />
          <MetricCard label="Questions asked" value={activity?.questions_asked ?? "—"} />
          <MetricCard label="Notes captured" value={activity?.notes_captured ?? "—"} />
        </div>
      </PageSection>
    </AppShell>
  );
}
