import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { Ban, ClipboardList, GitBranch, Lightbulb, MessageSquareText, Zap } from "lucide-react";
import { AppShell } from "@/components/relay/AppShell";
import {
  Avatar,
  BranchName,
  Chip,
  GhostButton,
  MetricCard,
  PageSection,
  Panel,
  ProgressRow,
  TicketKey,
} from "@/components/relay/primitives";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { handoverDetails, teamMembers, type HandoverSituation } from "@/lib/mockData";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/mgr/team/$id")({
  loader: ({ params }) => {
    const member = teamMembers.find((m) => m.id === params.id);
    if (!member) throw notFound();
    return { member };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.member.name ?? "Handover"} — Relay` },
      {
        name: "description",
        content:
          "Full work state, assignable handover, and knowledge-risk view assembled from Git and Jira, not from memory.",
      },
    ],
  }),
  component: TeamMemberHandover,
});

const TABS = ["Work state", "Assign handover", "Knowledge risks", "Handover kit"] as const;
type Tab = (typeof TABS)[number];

const SITUATIONS: { id: HandoverSituation; label: string }[] = [
  { id: "leave", label: "On leave" },
  { id: "leaving", label: "Leaving project" },
  { id: "onboarding", label: "Onboarding kit" },
];

const situationNote: Record<HandoverSituation, (firstName: string) => string> = {
  leave: (name) =>
    `${name} is on leave and expected back — coverage below is temporary. Focus on what needs an owner day-to-day, not a full knowledge transfer.`,
  leaving: (name) =>
    `${name} is leaving the project for good — treat the Knowledge risks tab as the priority. Anything unrecoverable there needs a transfer before the last day.`,
  onboarding: () =>
    "This page is still a single person's handover. For project-wide onboarding context, go back to Team handover and use the project overview instead.",
};

const priorityTone: Record<string, "danger" | "warning" | "success" | "neutral"> = {
  Critical: "danger",
  High: "warning",
  Review: "success",
  Low: "neutral",
};

const riskDot: Record<"high" | "medium" | "low", string> = {
  high: "bg-danger",
  medium: "bg-warning",
  low: "bg-success",
};

function TeamMemberHandover() {
  const { user } = Route.useRouteContext();
  const { member } = Route.useLoaderData();
  const detail = handoverDetails[member.id];
  const [tab, setTab] = useState<Tab>("Work state");
  const [situation, setSituation] = useState<HandoverSituation>(
    member.onLeave ? "leave" : "leaving",
  );

  if (!detail) {
    return (
      <AppShell user={user} title={`${member.name} — handover`}>
        <PageSection>
          <Panel>
            <p className="text-[13px] text-mute">No handover data recorded for this person yet.</p>
          </Panel>
        </PageSection>
      </AppShell>
    );
  }

  const firstName = member.name.split(" ")[0] ?? member.name;
  const otherMembers = teamMembers.filter((m) => m.id !== member.id);

  return (
    <AppShell user={user} title={`${member.name} — handover`}>
      <PageSection>
        <Link to="/mgr/team" className="text-[13px] font-medium text-brand">
          ← Team handover
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Avatar initials={member.initials} tone={member.tone} size={44} />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[16px] font-medium text-ink">{member.name}</h2>
                {member.onLeave ? <Chip tone="warning">On leave</Chip> : null}
              </div>
              <p className="text-[13px] text-mute">
                {member.role} · Last commit {member.lastCommit} · Active since {detail.activeSince}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {SITUATIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSituation(s.id)}
                className={cn(
                  "rounded-md border px-3 py-2 text-[12px] font-medium transition-colors duration-150",
                  situation === s.id
                    ? "border-brand bg-brand-soft text-brand"
                    : "border-border text-mute hover:text-ink",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-3 text-[12px] leading-relaxed text-mute italic">
          {situationNote[situation](firstName)}
        </p>
      </PageSection>

      <PageSection className="mb-4">
        <div className="flex gap-5 border-b border-border">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "-mb-px border-b-2 pb-2 text-[13px] font-medium transition-colors duration-150",
                tab === t
                  ? "border-brand text-brand"
                  : "border-transparent text-mute hover:text-ink",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </PageSection>

      {tab === "Work state" ? (
        <WorkStateTab firstName={firstName} detail={detail} openPrs={member.prs} />
      ) : null}
      {tab === "Assign handover" ? (
        <AssignHandoverTab detail={detail} otherMembers={otherMembers} />
      ) : null}
      {tab === "Knowledge risks" ? (
        <KnowledgeRisksTab firstName={firstName} detail={detail} />
      ) : null}
      {tab === "Handover kit" ? <HandoverKitTab /> : null}
    </AppShell>
  );
}

function WorkStateTab({
  firstName,
  detail,
  openPrs,
}: {
  firstName: string;
  detail: NonNullable<(typeof handoverDetails)[string]>;
  openPrs: number;
}) {
  return (
    <>
      <PageSection>
        <div className="grid grid-cols-3 gap-4">
          <MetricCard label="Open tickets" value={detail.tickets.length} />
          <MetricCard label="Open PRs" value={openPrs} tone="brand" />
          <MetricCard
            label={`Unreviewed (awaiting ${firstName})`}
            value={detail.prsAwaiting.length}
            tone={detail.prsAwaiting.length > 0 ? "danger" : "success"}
          />
        </div>
      </PageSection>

      <PageSection>
        <div className="grid grid-cols-2 gap-4">
          <Panel title="Open tickets" icon={<Zap className="size-3.5 text-mute" />}>
            <ul>
              {detail.tickets.map((t) => (
                <li key={t.key} className="border-b border-border py-2 last:border-0">
                  <div className="flex items-center gap-2">
                    <TicketKey>{t.key}</TicketKey>
                    <span className="flex-grow text-[13px] text-ink">{t.title}</span>
                    <Chip tone={priorityTone[t.priority] ?? "neutral"}>{t.priority}</Chip>
                  </div>
                  <div className="mt-0.5 text-[11px] text-mute">{t.note}</div>
                </li>
              ))}
            </ul>
          </Panel>

          <div className="flex flex-col gap-4">
            <Panel title="Open branches" icon={<GitBranch className="size-3.5 text-mute" />}>
              {detail.branches.length === 0 ? (
                <p className="py-2 text-[13px] text-mute">No branches ahead of main.</p>
              ) : (
                <ul>
                  {detail.branches.map((b) => (
                    <li key={b.name} className="border-b border-border py-2 last:border-0">
                      <BranchName>{b.name}</BranchName>
                      <div className="mt-0.5 text-[11px] text-mute">
                        {b.commitsAhead} commits ahead · unmerged
                      </div>
                      <div
                        className={cn(
                          "text-[11px]",
                          b.state === "mid-flight" ? "text-warning" : "text-mute",
                        )}
                      >
                        Last push {b.lastPush} — {b.state === "mid-flight" ? "mid-flight" : "stale"}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              title={`PRs awaiting ${firstName}`}
              icon={<MessageSquareText className="size-3.5 text-mute" />}
            >
              {detail.prsAwaiting.length === 0 ? (
                <p className="py-2 text-[13px] text-mute">Nothing waiting on this person.</p>
              ) : (
                <ul>
                  {detail.prsAwaiting.map((pr) => (
                    <li key={pr.key} className="border-b border-border py-2 last:border-0">
                      <div className="flex items-center gap-2">
                        <TicketKey>{pr.key}</TicketKey>
                        <span className="flex-grow text-[13px] text-ink">{pr.title}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-danger">
                        {pr.waitingDays > 0 ? `${pr.waitingDays} days waiting` : "waiting"} —
                        priority unblock
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      </PageSection>

      <PageSection label="What was mid-flight (last 7 days of activity)">
        <Panel>
          {detail.recentActivity.length === 0 ? (
            <p className="py-2 text-[13px] text-mute">No commits in the last 7 days.</p>
          ) : (
            <ul>
              {detail.recentActivity.map((c) => (
                <li
                  key={c.sha}
                  className="flex items-center gap-3 border-b border-border py-2 last:border-0"
                >
                  <span className="font-mono text-[12px] text-brand">{c.sha}</span>
                  <span className="flex-grow text-[13px] text-ink">{c.message}</span>
                  <span className="shrink-0 text-[11px] text-mute">{c.when}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </PageSection>
    </>
  );
}

function AssignHandoverTab({
  detail,
  otherMembers,
}: {
  detail: NonNullable<(typeof handoverDetails)[string]>;
  otherMembers: (typeof teamMembers)[number][];
}) {
  const urgencyOptions = ["Critical", "High", "Medium"] as const;
  const [ticketAssignee, setTicketAssignee] = useState<Record<string, string>>({});
  const [ticketUrgency, setTicketUrgency] = useState<Record<string, string>>({});
  const [prReviewer, setPrReviewer] = useState<Record<string, string>>({});
  const [branchOwner, setBranchOwner] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  return (
    <>
      <PageSection>
        <Panel
          title="Assign coverage for open work"
          icon={<ClipboardList className="size-3.5 text-mute" />}
        >
          <div className="section-label mb-2">Ticket coverage</div>
          <div className="mb-4 space-y-2">
            {detail.tickets.map((t) => (
              <div key={t.key} className="flex items-center gap-3">
                <Chip
                  tone={priorityTone[t.priority] ?? "neutral"}
                  className="w-24 shrink-0 justify-center"
                >
                  {t.key}
                </Chip>
                <Select
                  value={ticketAssignee[t.key] ?? ""}
                  onValueChange={(v) => setTicketAssignee((prev) => ({ ...prev, [t.key]: v }))}
                >
                  <SelectTrigger className="h-8 flex-grow text-[13px]">
                    <SelectValue placeholder="Select team member" />
                  </SelectTrigger>
                  <SelectContent>
                    {otherMembers.map((m) => (
                      <SelectItem key={m.id} value={m.name}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex shrink-0 gap-1">
                  {urgencyOptions.map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setTicketUrgency((prev) => ({ ...prev, [t.key]: u }))}
                      className={cn(
                        "rounded-sm border px-1.5 py-0.5 text-[11px] font-medium transition-colors duration-150",
                        ticketUrgency[t.key] === u
                          ? "border-brand bg-brand-soft text-brand"
                          : "border-border text-mute hover:text-ink",
                      )}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="section-label mb-2">PR review coverage</div>
          <div className="mb-4 space-y-2">
            {detail.prsAwaiting.length === 0 ? (
              <p className="text-[13px] text-mute">No PRs waiting on this person.</p>
            ) : (
              detail.prsAwaiting.map((pr) => (
                <div key={pr.key} className="flex items-center gap-3">
                  <TicketKey>{pr.key}</TicketKey>
                  <Select
                    value={prReviewer[pr.key] ?? ""}
                    onValueChange={(v) => setPrReviewer((prev) => ({ ...prev, [pr.key]: v }))}
                  >
                    <SelectTrigger className="h-8 flex-grow text-[13px]">
                      <SelectValue placeholder="Assign a reviewer" />
                    </SelectTrigger>
                    <SelectContent>
                      {otherMembers.map((m) => (
                        <SelectItem key={m.id} value={m.name}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="shrink-0 text-[11px] text-danger">
                    ⚠ Blocked {pr.waitingDays} {pr.waitingDays === 1 ? "day" : "days"}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="section-label mb-2">Branch owner</div>
          <div className="mb-4 space-y-2">
            {detail.branches.map((b) => (
              <div key={b.name} className="flex items-center gap-3">
                <BranchName>{b.name}</BranchName>
                <Select
                  value={branchOwner[b.name] ?? ""}
                  onValueChange={(v) => setBranchOwner((prev) => ({ ...prev, [b.name]: v }))}
                >
                  <SelectTrigger className="h-8 flex-grow text-[13px]">
                    <SelectValue placeholder="Assign owner" />
                  </SelectTrigger>
                  <SelectContent>
                    {otherMembers.map((m) => (
                      <SelectItem key={m.id} value={m.name}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span
                  className={cn(
                    "shrink-0 text-[11px]",
                    b.state === "mid-flight" ? "text-warning" : "text-mute",
                  )}
                >
                  {b.commitsAhead} commits, {b.state}
                </span>
              </div>
            ))}
          </div>

          <div className="section-label mb-2">Handover note to assignees</div>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything the next person should know that isn't captured in the tickets or commits..."
            className="min-h-[88px] text-[13px]"
          />
        </Panel>
      </PageSection>

      <PageSection>
        <div className="flex flex-wrap items-center gap-2">
          <GhostButton>Preview email to team</GhostButton>
          <GhostButton>Export as Markdown</GhostButton>
          <GhostButton tone="brand" onClick={() => setConfirmed(true)}>
            Confirm handover assignments
          </GhostButton>
        </div>
        {confirmed ? (
          <p className="mt-2 text-[12px] text-success">
            Assignments recorded — this would notify Jira and the assigned team members.
          </p>
        ) : null}
      </PageSection>
    </>
  );
}

function KnowledgeRisksTab({
  firstName,
  detail,
}: {
  firstName: string;
  detail: NonNullable<(typeof handoverDetails)[string]>;
}) {
  return (
    <>
      <PageSection label={`Knowledge only ${firstName} holds (inferred from commit + PR history)`}>
        <div className="space-y-2">
          {detail.knowledgeRisks.map((r) => (
            <div
              key={r.title}
              className="rounded-lg border border-border bg-surface-sunken px-4 py-3"
            >
              <div className="flex items-start gap-2">
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", riskDot[r.level])} />
                <div>
                  <p className="text-[13px] font-medium text-ink">{r.title}</p>
                  <p className="mt-0.5 text-[12px] text-mute">{r.detail}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </PageSection>

      <PageSection label={`Documentation coverage for ${firstName}'s areas`}>
        <Panel>
          <div className="space-y-1">
            {detail.docCoverage.map((d) => (
              <ProgressRow key={d.label} label={d.label} value={d.value} inline />
            ))}
          </div>
        </Panel>
      </PageSection>

      <PageSection>
        <div className="rounded-xl border border-brand bg-brand-soft/40 p-4">
          <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-brand">
            <Lightbulb className="size-3.5" />
            Recommended before {firstName} leaves
          </div>
          <ol className="space-y-1.5">
            {detail.recommendations.map((rec, i) => (
              <li
                key={rec}
                className="border-b border-border/60 pb-1.5 text-[13px] text-ink last:border-0"
              >
                {i + 1}. {rec}
              </li>
            ))}
          </ol>
        </div>
      </PageSection>
    </>
  );
}

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

function HandoverKitTab() {
  return (
    <>
      <PageSection subtitle="The complete package to send when someone transitions off the project.">
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
    </>
  );
}
