import { createFileRoute, Link } from "@tanstack/react-router";
import { Ban, ClipboardList, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import { GhostButton, PageSection, Panel } from "@/components/relay/primitives";

export const Route = createFileRoute("/_authenticated/mgr/team/$id/handover-kit")({
  head: () => ({
    meta: [
      { title: "Handover kit — Relay" },
      {
        name: "description",
        content: "The complete package to send when someone transitions off the project.",
      },
    ],
  }),
  component: HandoverKitPage,
});

const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

type JiraMember = { account_id: string; name: string };

const KIT_INCLUDED = [
  "Open ticket list with status and priority",
  "Open PRs and who is blocked waiting on them",
  "Unmerged branches with staleness indicator",
  "Last 10 commits with messages",
  "Coverage gaps (where only this person has context)",
  "Approved scratchpad notes (their own knowledge)",
  "Handover assignments (manager fills these)",
  "Manager's handover note",
];

const KIT_EXCLUDED = [
  "Performance metrics or velocity (personal data, DPDP)",
  "Comparison to other team members",
  "Time estimates or predictions",
  "Anything from client-confidential sources if this crosses a project boundary",
];

function HandoverKitPage() {
  const { user } = Route.useRouteContext();
  const { id } = Route.useParams();
  const [team, setTeam] = useState<JiraMember[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/project/team`);
        if (!res.ok) return;
        const json: JiraMember[] = await res.json();
        if (!cancelled) setTeam(json);
      } catch {
        // Header falls back to a generic title below.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const member = team?.find((m) => m.account_id === id);

  return (
    <AppShell user={user} title={member ? `${member.name} — handover kit` : "Handover kit"}>
      <PageSection>
        <Link to="/mgr/team/$id" params={{ id }} className="text-[13px] font-medium text-brand">
          ← Back to {member ? member.name : "handover"}
        </Link>
        {!team && (
          <div className="mt-2 flex items-center gap-2 text-[13px] text-mute">
            <Loader2 className="size-3.5 animate-spin" /> Loading…
          </div>
        )}
      </PageSection>

      <PageSection subtitle="The complete package to send when someone transitions off the project for good.">
        <div className="grid grid-cols-2 gap-4">
          <Panel title="What's included" icon={<ClipboardList className="size-3.5 text-mute" />}>
            <ul className="space-y-2">
              {KIT_INCLUDED.map((item) => (
                <li key={item} className="flex items-start gap-2 text-[13px] text-ink">
                  <span className="mt-0.5 text-success">✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="What is not included" icon={<Ban className="size-3.5 text-mute" />}>
            <ul className="space-y-2">
              {KIT_EXCLUDED.map((item) => (
                <li key={item} className="flex items-start gap-2 text-[13px] text-mute">
                  <span className="mt-0.5 text-danger">×</span>
                  {item}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </PageSection>

      <PageSection>
        <div className="flex flex-wrap gap-2">
          <GhostButton tone="brand">Preview full kit</GhostButton>
          <GhostButton>Copy as Markdown</GhostButton>
          <GhostButton>Send to Slack channel</GhostButton>
          <GhostButton>Export PDF</GhostButton>
        </div>
      </PageSection>
    </AppShell>
  );
}
