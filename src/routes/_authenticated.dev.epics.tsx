import { createFileRoute } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { AppShell } from "@/components/relay/AppShell";
import { Chip, GhostButton, PageSection, Panel, ProgressRow } from "@/components/relay/primitives";
import { epics } from "@/lib/mockData";

export const Route = createFileRoute("/_authenticated/dev/epics")({
  head: () => ({
    meta: [
      { title: "Epics — Relay" },
      {
        name: "description",
        content:
          "Deliverable-mapped epics with documentation and code coverage, so you know what's actually finished.",
      },
      { property: "og:title", content: "Epics — Relay" },
      {
        property: "og:description",
        content: "Epic progress against the signed contract's deliverables.",
      },
    ],
  }),
  component: Epics,
});

function Epics() {
  const { user } = Route.useRouteContext();
  return (
    <AppShell user={user} title="Epics">
      <PageSection label="Active epics" subtitle="Mapped to the deliverables in the signed SOW.">
        <div className="grid grid-cols-2 gap-4">
          {epics.map((epic) => (
            <Panel key={epic.key}>
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-[13px] font-medium text-ink">{epic.title}</h3>
                <Chip tone={epic.status === "On track" ? "success" : "warning"}>{epic.status}</Chip>
              </div>
              <p className="mt-1 text-[13px] text-mute">
                Maps to deliverable {epic.deliverable} from the signed contract
              </p>

              <div className="mt-4 grid grid-cols-2 gap-4">
                <ProgressRow label="Documentation coverage" value={epic.docCoverage} />
                <ProgressRow label="Code coverage (linked commits)" value={epic.codeCoverage} />
              </div>

              <div className="mt-4 flex items-center gap-2">
                <GhostButton>View docs ({epic.docs})</GhostButton>
                <GhostButton>View PRs ({epic.prs})</GhostButton>
                <GhostButton tone="brand">
                  <Sparkles /> Generate summary
                </GhostButton>
              </div>
            </Panel>
          ))}
        </div>
      </PageSection>

      <PageSection label="What coverage means here">
        <Panel>
          <p className="text-[13px] leading-relaxed text-mute">
            Code coverage counts commits linked to a ticket inside this epic. Documentation coverage
            counts tickets with an approved scratchpad note or wiki page. An epic can be
            code-complete and still undocumented — that gap is exactly what this page surfaces.
          </p>
        </Panel>
      </PageSection>
    </AppShell>
  );
}
