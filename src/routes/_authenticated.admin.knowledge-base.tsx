import { createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import {
  Chip,
  MetricCard,
  PageSection,
  Panel,
  SkeletonText,
} from "@/components/relay/primitives";
import { cachedJson } from "@/lib/relayApi";

export const Route = createFileRoute("/_authenticated/admin/knowledge-base")({
  head: () => ({
    meta: [
      { title: "Knowledge base — Relay" },
      {
        name: "description",
        content:
          "What Relay actually knows: retrieval corpus composition, document coverage and Ask Project performance.",
      },
    ],
  }),
  component: KnowledgeBase,
});

const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

// Chunks pulled automatically from Jira/GitHub vs. chunks from documents a
// human wrote. The split matters: connectors scale on their own, authored
// context doesn't, and a corpus dominated by commit messages answers "what
// changed" well but "why" badly.
const AUTOMATED_SOURCES = new Set(["github_commit", "github_pr", "jira_ticket"]);

type KnowledgeBaseData = {
  chunks_by_source: { source_type: string; count: number }[];
  total_chunks: number;
  documents: { doc_type: string; ingestion_status: string; count: number }[];
  ask: {
    questions: number | null;
    answers: number | null;
    abstained: number | null;
    avg_latency_ms: number | null;
    avg_chunks: number | null;
  };
};

function label(source: string) {
  return source.replace(/_/g, " ");
}

function KnowledgeBase() {
  const { user } = Route.useRouteContext();
  const [data, setData] = useState<KnowledgeBaseData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const json = await cachedJson<KnowledgeBaseData>(`${API_URL}/api/admin/knowledge-base`);
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Couldn't load the knowledge base.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const automated = data
    ? data.chunks_by_source
        .filter((c) => AUTOMATED_SOURCES.has(c.source_type))
        .reduce((sum, c) => sum + c.count, 0)
    : null;
  const authored = data && automated !== null ? data.total_chunks - automated : null;
  const authoredPct =
    data && authored !== null && data.total_chunks > 0
      ? Math.round((authored / data.total_chunks) * 100)
      : null;

  const needsReview = data
    ? data.documents
        .filter((d) => d.ingestion_status !== "confirmed")
        .reduce((sum, d) => sum + d.count, 0)
    : null;

  const chartData = data
    ? data.chunks_by_source.map((c) => ({
        name: label(c.source_type),
        count: c.count,
        automated: AUTOMATED_SOURCES.has(c.source_type),
      }))
    : [];

  const docTypes = data
    ? Object.values(
        data.documents.reduce<Record<string, { doc_type: string; count: number; review: number }>>(
          (acc, d) => {
            const entry = acc[d.doc_type] ?? { doc_type: d.doc_type, count: 0, review: 0 };
            entry.count += d.count;
            if (d.ingestion_status !== "confirmed") entry.review += d.count;
            acc[d.doc_type] = entry;
            return acc;
          },
          {},
        ),
      ).sort((a, b) => b.count - a.count)
    : [];

  return (
    <AppShell user={user} title="Knowledge base">
      <PageSection
        label="Corpus"
        subtitle="Everything Ask Project can retrieve from, and where it came from."
      >
        {error && <p className="text-[13px] text-danger">{error}</p>}
        <div className="grid grid-cols-4 gap-3">
          <MetricCard label="Total chunks" value={data?.total_chunks ?? "—"} emphasis />
          <MetricCard
            label="Authored context"
            value={authoredPct !== null ? `${authoredPct}%` : "—"}
            hint={authored !== null ? `${authored} chunks from documents` : undefined}
            tone={authoredPct !== null && authoredPct < 20 ? "warning" : "neutral"}
          />
          <MetricCard
            label="From connectors"
            value={automated ?? "—"}
            hint="Jira tickets, commits, PRs"
          />
          <MetricCard
            label="Docs needing review"
            value={needsReview ?? "—"}
            tone={needsReview ? "danger" : "neutral"}
          />
        </div>
      </PageSection>

      <PageSection label="Where knowledge comes from">
        <div className="grid grid-cols-3 gap-4">
          <Panel title="Chunks by source" className="col-span-2">
            {!data ? (
              <SkeletonText lines={6} />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={340}>
                  <BarChart data={chartData} layout="vertical" margin={{ left: 12, right: 16 }}>
                    <XAxis type="number" stroke="var(--mute)" fontSize={11} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={118}
                      stroke="var(--mute)"
                      fontSize={11}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: "var(--foreground)" }}
                      cursor={{ fill: "var(--surface-sunken)" }}
                    />
                    <Bar dataKey="count" name="Chunks" radius={[0, 4, 4, 0]}>
                      {chartData.map((entry) => (
                        <Cell
                          key={entry.name}
                          fill={entry.automated ? "var(--mute)" : "var(--highlight)"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="mt-2 text-[11px] leading-relaxed text-mute">
                  <span className="text-highlight">Highlighted</span> sources are documents a person
                  wrote; grey sources are pulled automatically from Jira and GitHub.
                </p>
              </>
            )}
          </Panel>

          <Panel title="Ask Project">
            {!data ? (
              <SkeletonText lines={4} />
            ) : (
              <>
                <div className="flex flex-col divide-y divide-border">
                  <AskStat label="Questions asked" value={data.ask.questions ?? "—"} />
                  <AskStat
                    label="Avg answer time"
                    value={data.ask.avg_latency_ms ? `${(data.ask.avg_latency_ms / 1000).toFixed(1)}s` : "—"}
                  />
                  <AskStat label="Sources per answer" value={data.ask.avg_chunks ?? "—"} />
                  <AskStat label="Unanswerable" value={data.ask.abstained ?? "—"} />
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-mute">
                  Based on {data.ask.questions ?? 0} question
                  {data.ask.questions === 1 ? "" : "s"} so far — too few to read as a trend yet.
                </p>
              </>
            )}
          </Panel>
        </div>
      </PageSection>

      <PageSection label="Document coverage">
        <Panel title="PM documents by type">
          {!data ? (
            <SkeletonText lines={5} />
          ) : docTypes.length === 0 ? (
            <p className="text-[13px] text-mute">No documents have been ingested yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {docTypes.map((d) => (
                <div
                  key={d.doc_type}
                  className="flex items-center gap-2 rounded-lg bg-surface-sunken px-3 py-2"
                >
                  <span className="text-[13px] text-ink">{label(d.doc_type)}</span>
                  <span className="text-[13px] font-semibold text-ink tabular-nums">{d.count}</span>
                  {d.review > 0 ? (
                    <Chip tone="warning">{d.review} to review</Chip>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </PageSection>
    </AppShell>
  );
}

function AskStat({ label: text, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between py-2 first:pt-0 last:pb-0">
      <span className="text-[13px] text-mute">{text}</span>
      <span className="text-[17px] font-semibold text-ink tabular-nums">{value}</span>
    </div>
  );
}
