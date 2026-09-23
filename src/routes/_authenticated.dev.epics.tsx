import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import {
  Chip,
  ExpandableText,
  GhostButton,
  PageSection,
  Panel,
  ProgressRow,
  SectionLabel,
} from "@/components/relay/primitives";
import { useMyProject } from "@/lib/admin/useMyProject";
import { cachedJson, relayFetch } from "@/lib/relayApi";

export const Route = createFileRoute("/_authenticated/dev/epics")({
  head: () => ({
    meta: [
      { title: "Epics — Relay" },
      {
        name: "description",
        content: "Real epics from Jira, with completion tracked from actual ticket status.",
      },
      { property: "og:title", content: "Epics — Relay" },
      {
        property: "og:description",
        content: "Epic progress against real Jira ticket completion.",
      },
    ],
  }),
  component: Epics,
});

const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

type Epic = {
  key: string;
  title: string;
  status: string;
  ticket_count: number;
  completion_pct: number;
};

function Epics() {
  const { user } = Route.useRouteContext();
  const { project, loading: loadingProject } = useMyProject(user.email);
  const [epics, setEpics] = useState<Epic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [summaryLoading, setSummaryLoading] = useState<string | null>(null);

  async function generateSummary(epicKey: string) {
    try {
      setSummaryLoading(epicKey);
      const response = await relayFetch(`${API_URL}/api/scope/epics/${epicKey}/summary`, {
        method: "POST",
      });
      if (!response.ok) throw new Error("Failed to generate AI summary");
      const data: { epic_key: string; summary: string } = await response.json();
      setSummaries((current) => ({ ...current, [epicKey]: data.summary }));
    } catch (err) {
      setSummaries((current) => ({
        ...current,
        [epicKey]: err instanceof Error ? err.message : "Couldn't generate a summary.",
      }));
    } finally {
      setSummaryLoading(null);
    }
  }

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({
          engagement_id: project.engagement_id,
          requester_email: user.email,
        });
        const json = await cachedJson<Epic[]>(`${API_URL}/api/project/epics?${params}`);
        if (!cancelled) setEpics(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load epics.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project, user.email]);

  return (
    <AppShell user={user} title="Epics">
      <PageSection
        label="Active epics"
        subtitle={project ? `Real epics tracked for ${project.name}.` : "Loading your project…"}
      >
        {loadingProject && (
          <div className="flex items-center gap-2 text-[13px] text-mute">
            <Loader2 className="size-3.5 animate-spin" /> Finding your project…
          </div>
        )}
        {error && <p className="text-[13px] text-danger">{error}</p>}
        {!epics && !error && (
          <div className="flex items-center gap-2 text-[13px] text-mute">
            <Loader2 className="size-3.5 animate-spin" /> Loading…
          </div>
        )}
        {epics && (
          <div className="grid grid-cols-2 gap-4">
            {epics.map((epic) => (
              <Panel key={epic.key}>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-[13px] font-medium text-ink">{epic.title}</h3>
                  <Chip
                    tone={
                      epic.status === "Done"
                        ? "success"
                        : epic.status === "In Progress"
                          ? "brand"
                          : "warning"
                    }
                  >
                    {epic.status}
                  </Chip>
                </div>
                <p className="mt-1 text-[13px] text-mute">
                  {epic.key} · {epic.ticket_count} ticket{epic.ticket_count === 1 ? "" : "s"}
                </p>

                <div className="mt-4">
                  <ProgressRow label="Completion" value={epic.completion_pct} />
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <GhostButton
                    tone="brand"
                    onClick={() => generateSummary(epic.key)}
                    disabled={summaryLoading === epic.key}
                  >
                    <Sparkles /> {summaryLoading === epic.key ? "Generating…" : "Generate summary"}
                  </GhostButton>
                </div>

                {summaries[epic.key] && (
                  <div className="mt-3 rounded-md border border-border bg-surface-soft p-2">
                    <div className="mb-1 flex items-center gap-1">
                      <Sparkles className="size-3 text-brand" />
                      <SectionLabel>AI summary</SectionLabel>
                    </div>
                    <ExpandableText
                      text={summaries[epic.key] ?? ""}
                      className="text-[12px] leading-5 text-ink"
                    />
                  </div>
                )}
              </Panel>
            ))}
          </div>
        )}
      </PageSection>

      <PageSection label="What completion means here">
        <Panel>
          <p className="text-[13px] leading-relaxed text-mute">
            Completion is the share of this epic's real Jira tickets currently in a Done-category
            status — not a self-reported estimate.
          </p>
        </Panel>
      </PageSection>
    </AppShell>
  );
}
