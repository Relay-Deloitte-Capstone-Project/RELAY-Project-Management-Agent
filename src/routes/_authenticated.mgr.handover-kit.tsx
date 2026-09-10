import { createFileRoute } from "@tanstack/react-router";
import {
  Ban,
  ClipboardList,
  GitBranch,
  Lightbulb,
  MessageSquareText,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/relay/AppShell";
import {
  BranchName,
  Chip,
  GhostButton,
  MetricCard,
  PageSection,
  Panel,
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
import {
  KIT_EXCLUDED,
  KIT_INCLUDED,
  LEAVING_PEOPLE,
  TEAM_MEMBER_OPTIONS,
  type LeavingPerson,
} from "@/lib/mgr/handoverKitMock";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/mgr/handover-kit")({
  head: () => ({
    meta: [
      { title: "Handover kit — Relay" },
      {
        name: "description",
        content: "Generate a full handover kit for a developer permanently leaving the project.",
      },
    ],
  }),
  component: HandoverKit,
});

const TABS = ["Work state", "Assign coverage", "Knowledge risks", "Export kit"] as const;
type Tab = (typeof TABS)[number];

const riskBorder: Record<"high" | "medium" | "low", string> = {
  high: "border-l-danger",
  medium: "border-l-warning",
  low: "border-l-success",
};

const riskDotEmoji: Record<"high" | "medium" | "low", string> = {
  high: "🔴",
  medium: "🟡",
  low: "🟢",
};

function docTone(pct: number) {
  if (pct > 70) return "bg-success";
  if (pct >= 40) return "bg-warning";
  return "bg-danger";
}

function docText(pct: number) {
  if (pct > 70) return "text-success";
  if (pct >= 40) return "text-warning";
  return "text-danger";
}

function notify() {
  toast("This would notify the team in production.");
}

function notifyExport() {
  toast("This would export in production.");
}

function HandoverKit() {
  const { user } = Route.useRouteContext();
  const [personId, setPersonId] = useState<LeavingPerson["id"]>("ravi");
  const [tab, setTab] = useState<Tab>("Work state");
  const person = LEAVING_PEOPLE.find((p) => p.id === personId)!;
  const firstName = person.name.split(" ")[0] ?? person.name;

  return (
    <AppShell user={user} title="Handover kit">
      <PageSection>
        <div className="flex flex-wrap gap-2">
          {LEAVING_PEOPLE.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setPersonId(p.id);
                setTab("Work state");
              }}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150",
                p.id === personId
                  ? "bg-brand text-brand-foreground"
                  : "bg-surface-sunken text-mute hover:text-ink",
              )}
            >
              {p.name}
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3.5 py-2.5">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <p className="text-[13px] leading-relaxed text-ink">
            <span className="font-semibold">{person.name}</span> is leaving the project on{" "}
            {person.leavingDate}. Handover kit generated automatically from Jira and GitHub data.
          </p>
        </div>
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

      {tab === "Work state" && <WorkStateTab person={person} />}
      {tab === "Assign coverage" && <AssignCoverageTab person={person} firstName={firstName} />}
      {tab === "Knowledge risks" && <KnowledgeRisksTab person={person} firstName={firstName} />}
      {tab === "Export kit" && <ExportKitTab />}
    </AppShell>
  );
}

function WorkStateTab({ person }: { person: LeavingPerson }) {
  return (
    <>
      <PageSection>
        <div className="grid grid-cols-3 gap-4">
          <MetricCard label="Open tickets" value={person.metrics.openTickets} tone="warning" />
          <MetricCard label="Open PRs" value={person.metrics.openPrs} tone="brand" />
          <MetricCard
            label="Unmerged branches"
            value={person.metrics.unmergedBranches}
            tone="danger"
          />
        </div>
      </PageSection>

      <PageSection>
        <Panel title="Critical open tickets" icon={<Zap className="size-3.5 text-mute" />}>
          {person.criticalTickets.length === 0 ? (
            <p className="py-2 text-[13px] text-mute">No open tickets.</p>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="section-label pb-2 pr-3 font-normal">Key</th>
                  <th className="section-label pb-2 pr-3 font-normal">Summary</th>
                  <th className="section-label pb-2 pr-3 font-normal">Status</th>
                  <th className="section-label pb-2 pr-3 font-normal">Priority</th>
                  <th className="section-label pb-2 font-normal">Last update</th>
                </tr>
              </thead>
              <tbody>
                {person.criticalTickets.map((t) => (
                  <tr key={t.key} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3">
                      <TicketKey>{t.key}</TicketKey>
                    </td>
                    <td className="py-2 pr-3 text-[13px] text-ink">{t.summary}</td>
                    <td className="py-2 pr-3 text-[13px] text-mute">{t.status}</td>
                    <td className="py-2 pr-3">
                      <Chip
                        tone={
                          t.priority === "Critical"
                            ? "danger"
                            : t.priority === "High"
                              ? "warning"
                              : t.priority === "Medium"
                                ? "brand"
                                : "neutral"
                        }
                      >
                        {t.priority}
                      </Chip>
                    </td>
                    <td className="py-2 text-[13px] text-mute">{t.daysSinceUpdate}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </PageSection>

      <PageSection>
        <div className="grid grid-cols-2 gap-4">
          <Panel title="Unmerged branches" icon={<GitBranch className="size-3.5 text-mute" />}>
            {person.branches.length === 0 ? (
              <p className="py-2 text-[13px] text-mute">No branches ahead of main.</p>
            ) : (
              <ul>
                {person.branches.map((b) => (
                  <li key={b.name} className="border-b border-border py-2 last:border-0">
                    <div className="flex items-center justify-between gap-2">
                      <BranchName>{b.name}</BranchName>
                      <Chip tone={b.state === "mid-flight" ? "warning" : "danger"}>{b.state}</Chip>
                    </div>
                    <div className="mt-0.5 text-[11px] text-mute">
                      {b.commitsAhead} {b.commitsAhead === 1 ? "commit" : "commits"} ahead · last
                      push {b.lastPush}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Last 7 days of activity"
            icon={<MessageSquareText className="size-3.5 text-mute" />}
          >
            <ul>
              {person.recentActivity.map((c) => (
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
          </Panel>
        </div>
      </PageSection>
    </>
  );
}

function AssignCoverageTab({ person, firstName }: { person: LeavingPerson; firstName: string }) {
  const [ticketAssignee, setTicketAssignee] = useState<Record<string, string>>(
    person.prefillAssignee,
  );
  const [ticketUrgency, setTicketUrgency] = useState<Record<string, string>>(person.prefillUrgency);
  const [branchOwner, setBranchOwner] = useState<Record<string, string>>({});
  const [branchDecision, setBranchDecision] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");

  const urgencyOptions = ["Critical", "High", "Medium"] as const;

  return (
    <>
      <PageSection subtitle={`Assign each open item to a team member before ${firstName} leaves.`}>
        <Panel title="Ticket coverage" icon={<ClipboardList className="size-3.5 text-mute" />}>
          <div className="space-y-2">
            {person.criticalTickets.map((t) => (
              <div key={t.key} className="flex items-center gap-3">
                <TicketKey>{t.key}</TicketKey>
                <span className="w-56 shrink-0 truncate text-[13px] text-ink">{t.summary}</span>
                <Select
                  value={ticketAssignee[t.key] ?? ""}
                  onValueChange={(v) => setTicketAssignee((prev) => ({ ...prev, [t.key]: v }))}
                >
                  <SelectTrigger className="h-8 flex-grow text-[13px]">
                    <SelectValue placeholder="Select team member" />
                  </SelectTrigger>
                  <SelectContent>
                    {TEAM_MEMBER_OPTIONS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
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
        </Panel>
      </PageSection>

      <PageSection>
        <Panel title="Branch ownership" icon={<GitBranch className="size-3.5 text-mute" />}>
          {person.branches.length === 0 ? (
            <p className="text-[13px] text-mute">No branches to reassign.</p>
          ) : (
            <div className="space-y-2">
              {person.branches.map((b) => (
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
                      {TEAM_MEMBER_OPTIONS.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={branchDecision[b.name] ?? ""}
                    onValueChange={(v) => setBranchDecision((prev) => ({ ...prev, [b.name]: v }))}
                  >
                    <SelectTrigger className="h-8 w-40 shrink-0 text-[13px]">
                      <SelectValue placeholder="Decision" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Take over">Take over</SelectItem>
                      <SelectItem value="Merge as-is">Merge as-is</SelectItem>
                      <SelectItem value="Close with note">Close with note</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </PageSection>

      <PageSection>
        <Panel
          title="Manager handover note"
          icon={<MessageSquareText className="size-3.5 text-mute" />}
        >
          <div className="section-label mb-2">Add context the system can't infer</div>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={`e.g. ${firstName} was mid-discussion with the platform team about the auth redesign. The approach in KAFKA-16180 is not final — talk to Jun before merging.`}
            className="min-h-[88px] text-[13px]"
          />
        </Panel>
      </PageSection>

      <PageSection>
        <div className="flex flex-wrap items-center gap-2">
          <GhostButton onClick={notify}>Preview email to team</GhostButton>
          <GhostButton onClick={notify}>Export as Markdown</GhostButton>
          <GhostButton tone="brand" onClick={notify}>
            Confirm assignments →
          </GhostButton>
        </div>
      </PageSection>
    </>
  );
}

function KnowledgeRisksTab({ person, firstName }: { person: LeavingPerson; firstName: string }) {
  return (
    <>
      <PageSection label={`What only ${firstName} knows — inferred from commit history`}>
        <div className="space-y-2">
          {person.knowledgeRisks.map((r) => (
            <div
              key={r.title}
              className={cn(
                "rounded-r-lg border-l-4 bg-card px-4 py-3 shadow-sm",
                riskBorder[r.level],
              )}
            >
              <p className="text-[13px] font-medium text-ink">
                {riskDotEmoji[r.level]} {r.title}
              </p>
              <p className="mt-0.5 pl-5 text-[12px] text-mute">{r.detail}</p>
            </div>
          ))}
        </div>
      </PageSection>

      <PageSection label="Documentation coverage">
        <Panel>
          <div className="space-y-3">
            {person.docCoverage.map((d) => (
              <div key={d.label}>
                <div className="mb-1 flex items-center justify-between text-[13px]">
                  <span className="text-mute">{d.label}</span>
                  <span className={cn("font-semibold", docText(d.value))}>{d.value}%</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-surface-sunken">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-700",
                      docTone(d.value),
                    )}
                    style={{ width: `${d.value}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </PageSection>

      <PageSection>
        <div className="rounded-xl border border-warning bg-warning-soft/40 p-4">
          <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-warning">
            <Lightbulb className="size-3.5" />
            Before {firstName}'s last day
          </div>
          <ol className="space-y-1.5">
            {person.recommendations.map((rec, i) => (
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

function ExportKitTab() {
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
          <Panel title="What's NOT included" icon={<Ban className="size-3.5 text-mute" />}>
            <ul className="space-y-2">
              {KIT_EXCLUDED.map((item) => (
                <li key={item} className="flex items-start gap-2 text-[13px] text-mute">
                  <span className="mt-0.5 text-danger">✗</span>
                  {item}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <p className="mt-3 text-[12px] text-mute italic">
          This kit contains work state, not performance judgment.
        </p>
      </PageSection>

      <PageSection>
        <div className="flex flex-wrap gap-2">
          <GhostButton tone="brand" onClick={notifyExport}>
            Preview full kit
          </GhostButton>
          <GhostButton onClick={notifyExport}>Copy as Markdown</GhostButton>
          <GhostButton onClick={notifyExport}>Export PDF</GhostButton>
        </div>
      </PageSection>
    </>
  );
}
