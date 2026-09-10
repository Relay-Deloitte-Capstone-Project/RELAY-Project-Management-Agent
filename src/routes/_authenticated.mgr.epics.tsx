import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import {
  Chip,
  GhostButton,
  PageSection,
  Panel,
  ProgressRow,
  SectionLabel,
} from "@/components/relay/primitives";

export const Route = createFileRoute("/_authenticated/mgr/epics")({
  head: () => ({
    meta: [
      { title: "Epic progress — Relay" },
      {
        name: "description",
        content: "Real completion and scope compliance for every epic, from actual Jira ticket status.",
      },
      { property: "og:title", content: "Epic progress — Relay" },
      {
        property: "og:description",
        content: "Completion and scope compliance for each epic, from real Jira data.",
      },
    ],
  }),
  component: ManagerEpics,
});

const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

type Epic = {
  key: string;
  title: string;
  status: string;
  ticket_count: number;
  completion_pct: number;
  scope_compliance_pct: number;
};

function ManagerEpics() {
  const { user } = Route.useRouteContext();
  const [epics, setEpics] = useState<Epic[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/project/epics`);
        if (!res.ok) throw new Error("Request failed");
        const json: Epic[] = await res.json();
        if (!cancelled) setEpics(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load epics.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell user={user} title="Epic progress">
      <PageSection label="Active epics" subtitle="Real epics from the KPD Jira board.">
        {error && <p className="text-[13px] text-danger">{error}</p>}
        {!epics && !error && (
          <div className="flex items-center gap-2 text-[13px] text-mute">
            <Loader2 className="size-3.5 animate-spin" /> Loading…
          </div>
        )}
        {epics && (
          <div className="grid grid-cols-2 gap-4">
            {epics.map((epic) => {
              const scopeRisk = epic.scope_compliance_pct < 90;
              return (
                <Panel key={epic.key}>
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-[13px] font-medium text-ink">{epic.title}</h3>
                    <Chip tone={epic.status === "Done" ? "success" : epic.status === "In Progress" ? "brand" : "warning"}>
                      {epic.status}
                    </Chip>
                  </div>
                  <p className="mt-1 text-[13px] text-mute">
                    {epic.key} · {epic.ticket_count} ticket{epic.ticket_count === 1 ? "" : "s"}
                  </p>

                  <div className="mt-4 flex flex-col gap-3">
                    <div>
                      <SectionLabel>Scope compliance</SectionLabel>
                      <ProgressRow
                        label="Tickets in scope"
                        value={epic.scope_compliance_pct}
                        tone={scopeRisk ? "warning" : "success"}
                        inline
                      />
                    </div>
                    <div>
                      <SectionLabel>Completion</SectionLabel>
                      <ProgressRow label="Tickets done" value={epic.completion_pct} inline />
                    </div>
                  </div>

                  {scopeRisk ? (
                    <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-warning-border bg-warning-soft p-3 text-[11px] text-warning-strong">
                      <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                      <span>
                        Only {epic.scope_compliance_pct}% of this epic's tickets are in scope —
                        the rest are labeled out-of-scope or ambiguous in Jira.
                      </span>
                    </div>
                  ) : null}

                  <div className="mt-4 flex items-center gap-2">
                    <GhostButton tone="brand">
                      <Sparkles /> Generate summary
                    </GhostButton>
                  </div>
                </Panel>
              );
            })}
          </div>
        )}
      </PageSection>
    </AppShell>
  );
}
