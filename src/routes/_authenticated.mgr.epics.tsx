import { createFileRoute } from "@tanstack/react-router";
import { Sparkles, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/relay/AppShell";
import {
  Chip,
  GhostButton,
  PageSection,
  Panel,
  ProgressRow,
  SectionLabel,
} from "@/components/relay/primitives";
import { epics } from "@/lib/mockData";

export const Route = createFileRoute("/_authenticated/mgr/epics")({
  head: () => ({
    meta: [
      { title: "Epic progress — Relay" },
      {
        name: "description",
        content:
          "Deliverable alignment, documentation coverage and code coverage for every active epic, with knowledge-loss warnings when they diverge.",
      },
      { property: "og:title", content: "Epic progress — Relay" },
      {
        property: "og:description",
        content: "Scope alignment, documentation and implementation for each epic.",
      },
    ],
  }),
  component: ManagerEpics,
});

function ManagerEpics() {
  const { user } = Route.useRouteContext();
  return (
    <AppShell user={user} title="Epic progress">
      <PageSection label="Active epics" subtitle="Mapped to the deliverables in the signed SOW.">
        <div className="grid grid-cols-2 gap-4">
          {epics.map((epic) => {
            const knowledgeRisk = epic.codeCoverage > 70 && epic.docCoverage < 40;
            return (
              <Panel key={epic.key}>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-[13px] font-medium text-ink">{epic.title}</h3>
                  <Chip tone={epic.status === "On track" ? "success" : "warning"}>
                    {epic.status}
                  </Chip>
                </div>
                <p className="mt-1 text-[13px] text-mute">
                  Maps to deliverable {epic.deliverable} from the signed contract
                </p>

                <div className="mt-4 flex flex-col gap-3">
                  <div>
                    <SectionLabel>Deliverable alignment</SectionLabel>
                    <ProgressRow
                      label="Tickets in scope"
                      value={epic.scopeAlignment}
                      tone={epic.scopeAlignment < 100 ? "warning" : "success"}
                      inline
                    />
                  </div>
                  <div>
                    <SectionLabel>Documentation</SectionLabel>
                    <ProgressRow label="Doc coverage" value={epic.docCoverage} inline />
                  </div>
                  <div>
                    <SectionLabel>Implementation</SectionLabel>
                    <ProgressRow label="Code coverage" value={epic.codeCoverage} inline />
                  </div>
                </div>

                {knowledgeRisk ? (
                  <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-warning-border bg-warning-soft p-3 text-[11px] text-warning-strong">
                    <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                    <span>
                      This epic is {epic.codeCoverage}% built but only {epic.docCoverage}%
                      documented — risk of knowledge loss if team members rotate.
                    </span>
                  </div>
                ) : null}

                <div className="mt-4 flex items-center gap-2">
                  <GhostButton>Docs ({epic.docs})</GhostButton>
                  <GhostButton>PRs ({epic.prs})</GhostButton>
                  <GhostButton tone="brand">
                    <Sparkles /> Generate summary
                  </GhostButton>
                </div>
              </Panel>
            );
          })}
        </div>
      </PageSection>
    </AppShell>
  );
}
