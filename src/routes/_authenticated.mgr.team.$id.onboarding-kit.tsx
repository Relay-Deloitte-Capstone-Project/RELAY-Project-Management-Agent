import { createFileRoute, Link } from "@tanstack/react-router";
import { Ban, Check, ClipboardList, Loader2, UserCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import {
  Avatar,
  Chip,
  GhostButton,
  PageSection,
  Panel,
  TicketKey,
} from "@/components/relay/primitives";

export const Route = createFileRoute("/_authenticated/mgr/team/$id/onboarding-kit")({
  head: () => ({
    meta: [
      { title: "Onboarding kit — Relay" },
      {
        name: "description",
        content: "What a new team member needs to pick up someone's open work.",
      },
    ],
  }),
  component: OnboardingKitPage,
});

const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

type JiraMember = {
  account_id: string;
  name: string;
  to_do: number;
  in_progress: number;
  done: number;
};
type Ticket = { key: string; summary: string; status: string; created: string };

const ONBOARD_INCLUDED = [
  "Access checklist — Jira, GitHub and Relay login",
  "This person's currently open tickets as starting context",
  "A suggested mentor for the first two weeks",
  "Project overview and scope guardrails",
  "Where to find approved scratchpad notes",
];

const ONBOARD_EXCLUDED = [
  "Performance metrics or velocity of the person being replaced (personal data, DPDP)",
  "Comparison to other team members",
  "Anything from client-confidential sources if this crosses a project boundary",
];

function OnboardingKitPage() {
  const { user } = Route.useRouteContext();
  const { id } = Route.useParams();
  const [team, setTeam] = useState<JiraMember[] | null>(null);
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/project/team`);
        if (!res.ok) throw new Error("Request failed");
        const json: JiraMember[] = await res.json();
        if (!cancelled) setTeam(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load the team.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const member = team?.find((m) => m.account_id === id);

  useEffect(() => {
    if (!member) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_URL}/api/project/tickets?assignee=${encodeURIComponent(member.name)}`,
        );
        if (!res.ok) return;
        const json: Ticket[] = await res.json();
        if (!cancelled) setTickets(json.filter((t) => t.status !== "Done"));
      } catch {
        // Starting-tickets card just stays empty.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [member?.name]);

  if (error) {
    return (
      <AppShell user={user} title="Onboarding kit">
        <PageSection>
          <p className="text-[13px] text-danger">{error}</p>
        </PageSection>
      </AppShell>
    );
  }

  if (!team) {
    return (
      <AppShell user={user} title="Onboarding kit">
        <PageSection>
          <div className="flex items-center gap-2 text-[13px] text-mute">
            <Loader2 className="size-3.5 animate-spin" /> Loading…
          </div>
        </PageSection>
      </AppShell>
    );
  }

  if (!member) {
    return (
      <AppShell user={user} title="Onboarding kit">
        <PageSection>
          <Panel>
            <p className="text-[13px] text-mute">No one on the team matches this link.</p>
          </Panel>
        </PageSection>
      </AppShell>
    );
  }

  const mentor = team
    .filter((m) => m.account_id !== member.account_id)
    .sort((a, b) => b.done - a.done)[0];

  return (
    <AppShell user={user} title={`${member.name}'s work — onboarding kit`}>
      <PageSection>
        <Link to="/mgr/team/$id" params={{ id }} className="text-[13px] font-medium text-brand">
          ← Back to {member.name}
        </Link>
        <p className="mt-2 text-[12px] leading-relaxed text-mute italic">
          Whoever picks up {member.name.split(" ")[0]}'s work starts here — real open tickets and a
          suggested mentor, not a blank slate.
        </p>
      </PageSection>

      <PageSection>
        <Panel title="Access checklist" icon={<UserCheck className="size-3.5 text-mute" />}>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-ink">Jira project access</span>
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-success">
                <Check className="size-3.5" /> Grant on day one
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-ink">GitHub repo access</span>
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-mute">
                <X className="size-3.5 text-danger" /> Not connected for this project yet
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-ink">Relay login</span>
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-success">
                <Check className="size-3.5" /> Invite from Admin → All users
              </span>
            </div>
          </div>
        </Panel>
      </PageSection>

      <PageSection>
        <div className="grid grid-cols-2 gap-4">
          <Panel title="Starting tickets" icon={<ClipboardList className="size-3.5 text-mute" />}>
            {!tickets ? (
              <div className="flex items-center gap-2 py-2 text-[13px] text-mute">
                <Loader2 className="size-3.5 animate-spin" /> Loading…
              </div>
            ) : tickets.length === 0 ? (
              <p className="py-2 text-[13px] text-mute">No open tickets to inherit right now.</p>
            ) : (
              <ul>
                {tickets.slice(0, 8).map((t) => (
                  <li key={t.key} className="border-b border-border py-2 last:border-0">
                    <div className="flex items-center gap-2">
                      <TicketKey>{t.key}</TicketKey>
                      <span className="flex-grow text-[13px] text-ink">{t.summary}</span>
                      <Chip tone={t.status === "In Progress" ? "brand" : "neutral"}>
                        {t.status}
                      </Chip>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Suggested mentor" icon={<UserCheck className="size-3.5 text-mute" />}>
            {mentor ? (
              <div className="flex items-center gap-3">
                <Avatar initials={mentor.name.slice(0, 2).toUpperCase()} />
                <div>
                  <p className="text-[13px] font-medium text-ink">{mentor.name}</p>
                  <p className="text-[12px] text-mute">
                    {mentor.done} tickets shipped — most closed work on the team, a good first point
                    of contact.
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-[13px] text-mute">No other team member to suggest yet.</p>
            )}
          </Panel>
        </div>
      </PageSection>

      <PageSection subtitle="What the full onboarding kit covers when it's ready to send.">
        <div className="grid grid-cols-2 gap-4">
          <Panel title="What's included" icon={<ClipboardList className="size-3.5 text-mute" />}>
            <ul className="space-y-2">
              {ONBOARD_INCLUDED.map((item) => (
                <li key={item} className="flex items-start gap-2 text-[13px] text-ink">
                  <span className="mt-0.5 text-success">✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="What is not included" icon={<Ban className="size-3.5 text-mute" />}>
            <ul className="space-y-2">
              {ONBOARD_EXCLUDED.map((item) => (
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
        </div>
      </PageSection>
    </AppShell>
  );
}
