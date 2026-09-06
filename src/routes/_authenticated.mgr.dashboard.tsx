import { createFileRoute } from "@tanstack/react-router";
import { Shield, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/relay/AppShell";
import { MetricCard, PageSection, Panel, ProgressRow } from "@/components/relay/primitives";
import { riskSignals, scopeHealth, weeklyActivity } from "@/lib/mockData";

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

function ManagerDashboard() {
  const { user } = Route.useRouteContext();
  return (
    <AppShell user={user} title="Dashboard">
      <PageSection label="Team">
        <div className="grid grid-cols-4 gap-3">
          <MetricCard label="Team members" value={6} />
          <MetricCard label="Open tickets" value={34} tone="warning" />
          <MetricCard label="Ticket coverage" value="62%" tone="brand" />
          <MetricCard label="Scope alerts" value={3} tone="danger" />
        </div>
      </PageSection>

      <PageSection>
        <div className="grid grid-cols-2 gap-4">
          <Panel title="Scope health" icon={<Shield className="size-3.5 text-mute" />}>
            {scopeHealth.map((row) => (
              <ProgressRow
                key={row.label}
                label={row.label}
                value={row.value}
                tone={row.tone}
                inline
              />
            ))}
          </Panel>

          <Panel title="Risk signals" icon={<TriangleAlert className="size-3.5 text-mute" />}>
            <div className="flex flex-col gap-2">
              {riskSignals.map((risk) => (
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

      <PageSection label="This week">
        <div className="grid grid-cols-4 gap-3">
          {weeklyActivity.map((row) => (
            <MetricCard key={row.label} label={row.label} value={row.value} />
          ))}
        </div>
      </PageSection>
    </AppShell>
  );
}
