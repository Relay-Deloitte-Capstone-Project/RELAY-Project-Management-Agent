/* eslint-disable prettier/prettier */
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import {
  Chip,
  ExpandableText,
  GhostButton,
  PageSection,
  Panel,
  SectionLabel,
} from "@/components/relay/primitives";
import { cachedJson, relayFetch } from "@/lib/relayApi";

type Epic = {
  epic_key: string;
  ticket_count: number;
  completion_percent: number;
  scope_compliance_percent: number;
  status: string;
};

type Summary = {
  epic_key: string;
  summary: string;
};

const API = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

const EPIC_NAMES: Record<string, string> = {
  "KPD-1": "Data Ingestion Connectors (Jira + GitHub)",
  "KPD-2": "Ticket-to-Commit Linkage & Coverage Reporting",
  "KPD-3": "Hybrid Search & Cited Q&A",
  "KPD-4": "Handover Brief & Work-State Assembly",
  "KPD-5": "Scope Guardian — SOW Parsing & Classification",
  "KPD-6": "Provenance & Read-Time Permission Evaluation",
  "KPD-7": "Secrets Scanning & Canary Tokens",
  "KPD-8": "Auto-Draft from PRs — Assisted Capture",
};

const EPIC_NUMBERS: Record<string, string> = {
  "KPD-1": "Epic 1",
  "KPD-2": "Epic 2",
  "KPD-3": "Epic 3",
  "KPD-4": "Epic 4",
  "KPD-5": "Epic 5",
  "KPD-6": "Epic 6",
  "KPD-7": "Epic 7",
  "KPD-8": "Epic 8",
};

export const Route = createFileRoute("/_authenticated/mgr/epics")({
  head: () => ({
    meta: [
      { title: "Epic progress — Relay" },
      {
        name: "description",
        content: "Live Jira epic progress, SOW alignment and AI summaries.",
      },
      { property: "og:title", content: "Epic progress — Relay" },
      {
        property: "og:description",
        content: "Live Jira epic progress with SOW alignment and AI summaries.",
      },
    ],
  }),
  component: ManagerEpics,
});

function ManagerEpics() {
  const { user } = Route.useRouteContext();

  const [epics, setEpics] = useState<Epic[]>([]);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState<string | null>(null);

  async function loadEpics() {
    try {
      setRefreshing(true);

      // Always force a fresh fetch here, never the cache — this page already
      // polls every 30s and has its own manual Refresh button, both of which
      // would otherwise just re-serve the same minute-old cached snapshot.
      const data = await cachedJson<Epic[]>(`${API}/api/scope/epics`, { fresh: true });
      setEpics(data);
    } catch (error) {
      console.error("Failed to load epic progress:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function generateSummary(epicKey: string) {
    try {
      setSummaryLoading(epicKey);

      const response = await relayFetch(`${API}/api/scope/epics/${epicKey}/summary`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to generate AI summary");
      }

      const data: Summary = await response.json();

      setSummaries((current) => ({
        ...current,
        [epicKey]: data.summary,
      }));
    } catch (error) {
      console.error("Failed to generate AI summary:", error);
    } finally {
      setSummaryLoading(null);
    }
  }

  useEffect(() => {
    loadEpics();

    const interval = window.setInterval(loadEpics, 30000);

    return () => window.clearInterval(interval);
  }, []);

  const totalTickets = epics.reduce((sum, epic) => sum + epic.ticket_count, 0);

  const onTrackCount = epics.filter((epic) => epic.scope_compliance_percent >= 80).length;

  const atRiskCount = epics.filter(
    (epic) => epic.scope_compliance_percent >= 50 && epic.scope_compliance_percent < 80,
  ).length;

  const attentionCount = epics.filter((epic) => epic.scope_compliance_percent < 50).length;

  return (
    <AppShell user={user} title="Epic progress">
      <PageSection
        label="Active epics"
        subtitle="Live Jira progress mapped to the deliverables in the signed SOW."
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[11px] text-mute">
            Jira progress refreshes automatically every 30 seconds.
          </p>

          <GhostButton onClick={loadEpics} disabled={refreshing}>
            <RefreshCw className={refreshing ? "animate-spin" : ""} />
            Refresh
          </GhostButton>
        </div>

        {loading ? (
          <Panel>
            <p className="text-[13px] text-mute">Loading live Jira epic progress...</p>
          </Panel>
        ) : epics.length === 0 ? (
          <Panel>
            <p className="text-[13px] text-mute">No epic progress data available.</p>
          </Panel>
        ) : (
          <>
            <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <SummaryCard
                label="Total epics"
                value={epics.length}
                detail={`${totalTickets} Jira tickets`}
              />

              <SummaryCard
                label="On track"
                value={onTrackCount}
                detail="80%+ scope alignment"
                tone="success"
              />

              <SummaryCard
                label="At risk"
                value={atRiskCount}
                detail="50–79% scope alignment"
                tone="warning"
              />

              <SummaryCard
                label="Needs attention"
                value={attentionCount}
                detail="Below 50% scope alignment"
                tone="danger"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {epics.map((epic) => {
                const knowledgeRisk =
                  epic.completion_percent > 70 && epic.scope_compliance_percent < 40;

                const scopePercent = Math.min(100, Math.max(0, epic.scope_compliance_percent));

                const completionPercent = Math.min(100, Math.max(0, epic.completion_percent));

                const scopeBar =
                  epic.scope_compliance_percent >= 80
                    ? "bg-success"
                    : epic.scope_compliance_percent >= 50
                      ? "bg-warning"
                      : "bg-danger";

                const completionBar = epic.completion_percent >= 70 ? "bg-success" : "bg-warning";

                const scopeText =
                  epic.scope_compliance_percent >= 80
                    ? "text-success"
                    : epic.scope_compliance_percent >= 50
                      ? "text-warning"
                      : "text-danger";

                return (
                  <Panel key={epic.epic_key} className="min-w-0 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="shrink-0 text-[13px] font-semibold text-ink">
                            {EPIC_NUMBERS[epic.epic_key] ?? epic.epic_key}
                          </h3>

                          <Chip
                            tone={
                              epic.status.toLowerCase().includes("done") ? "success" : "warning"
                            }
                          >
                            {epic.status}
                          </Chip>
                        </div>

                        <p className="mt-1 line-clamp-2 min-h-[28px] text-[11px] leading-4 text-mute">
                          {EPIC_NAMES[epic.epic_key] ?? epic.epic_key}
                        </p>

                        <p className="mt-1 text-[10px] text-mute">
                          {epic.ticket_count} Jira tickets
                        </p>
                      </div>
                    </div>

                    <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between">
                        <SectionLabel>Scope alignment</SectionLabel>
                        <span className={`text-[11px] font-semibold ${scopeText}`}>
                          {epic.scope_compliance_percent.toFixed(1)}%
                        </span>
                      </div>

                      <div className="h-1.5 overflow-hidden rounded-full bg-border">
                        <div
                          className={`h-full rounded-full ${scopeBar}`}
                          style={{ width: `${scopePercent}%` }}
                        />
                      </div>
                    </div>

                    <div className="mt-2">
                      <div className="mb-1 flex items-center justify-between">
                        <SectionLabel>Jira completion</SectionLabel>
                        <span
                          className={`text-[11px] font-semibold ${
                            epic.completion_percent >= 70 ? "text-success" : "text-warning"
                          }`}
                        >
                          {epic.completion_percent.toFixed(1)}%
                        </span>
                      </div>

                      <div className="h-1.5 overflow-hidden rounded-full bg-border">
                        <div
                          className={`h-full rounded-full ${completionBar}`}
                          style={{ width: `${completionPercent}%` }}
                        />
                      </div>
                    </div>

                    {knowledgeRisk ? (
                      <div className="mt-2 flex items-start gap-1.5 rounded-md border border-warning-border bg-warning-soft p-2 text-[9px] leading-3 text-warning-strong">
                        <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                        <span>High completion but low scope alignment.</span>
                      </div>
                    ) : null}

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        className="text-[10px] font-medium text-brand hover:underline"
                      >
                        Tickets ({epic.ticket_count})
                      </button>

                      <GhostButton
                        tone="brand"
                        onClick={() => generateSummary(epic.epic_key)}
                        disabled={summaryLoading === epic.epic_key}
                      >
                        <Sparkles />
                        {summaryLoading === epic.epic_key ? "Generating..." : "Summary"}
                      </GhostButton>
                    </div>

                    {summaries[epic.epic_key] ? (
                      <div className="mt-2 rounded-md border border-border bg-surface-soft p-2">
                        <div className="mb-1 flex items-center gap-1">
                          <Sparkles className="size-3 text-brand" />
                          <SectionLabel>AI summary</SectionLabel>
                        </div>

                        <ExpandableText
                          text={summaries[epic.epic_key] ?? ""}
                          className="text-[10px] leading-4 text-ink"
                        />
                      </div>
                    ) : null}
                  </Panel>
                );
              })}
            </div>
          </>
        )}
      </PageSection>
    </AppShell>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: number;
  detail: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const toneClass = {
    neutral: "text-ink",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
  }[tone];

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-mute">{label}</p>

      <div className="mt-1 flex items-end gap-2">
        <span className={`text-xl font-semibold ${toneClass}`}>{value}</span>

        <span className="mb-0.5 text-[9px] text-mute">epics</span>
      </div>

      <p className="mt-0.5 text-[9px] text-mute">{detail}</p>
    </div>
  );
}
