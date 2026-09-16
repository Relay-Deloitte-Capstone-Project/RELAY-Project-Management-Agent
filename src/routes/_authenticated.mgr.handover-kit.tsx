import { teamMembers } from "@/lib/mockData";
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
import { useEffect, useRef, useState } from "react";
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
type JiraTicket = {
  key: string;
  summary: string;
  status: string;
  priority: string;
  assignee: string | null;
  assignee_account_id: string | null;
  updated: string;
};

type JiraMember = {
  account_id: string;
  name: string;
};

const API_BASE = "http://127.0.0.1:8001";
function HandoverKit() {
  const { user } = Route.useRouteContext();
  const [personId, setPersonId] = useState<string>("");
  const [tab, setTab] = useState<Tab>("Work state");
  const [jiraTickets, setJiraTickets] = useState<JiraTicket[]>([]);
  const [jiraMembers, setJiraMembers] = useState<JiraMember[]>([]);
  const [jiraLoading, setJiraLoading] = useState(true);

  const selectedJiraMember =
    jiraMembers.find((member) => member.account_id === personId) ??
    jiraMembers.find((member) => member.name === personId);
  const selectedMockPerson = selectedJiraMember
    ? LEAVING_PEOPLE.find(
        (member) =>
          member.name.trim().toLowerCase() === selectedJiraMember.name.trim().toLowerCase(),
      )
    : undefined;

  const emptyPerson: LeavingPerson = {
    id: "jira" as LeavingPerson["id"],
    name: "Select a developer",
    leavingDate: "after the developer is marked on leave in Jira",
    prefillUrgency: {},
    prefillAssignee: {},
    metrics: { openTickets: 0, openPrs: 0, unmergedBranches: 0 },
    criticalTickets: [],
    branches: [],
    recentActivity: [],
    knowledgeRisks: [],
    docCoverage: [],
    recommendations: [],
  };

  const person: LeavingPerson = selectedMockPerson
    ? { ...selectedMockPerson, id: personId as LeavingPerson["id"], name: selectedJiraMember!.name }
    : emptyPerson;
  const firstName = person.name.split(" ")[0] ?? person.name;

  useEffect(() => {
    async function loadJiraData() {
      try {
        setJiraLoading(true);

        const [ticketsResponse, membersResponse] = await Promise.all([
          fetch(`${API_BASE}/api/handover/kpd/tickets`),
          fetch(`${API_BASE}/api/project/team`),
        ]);

        if (!ticketsResponse.ok) {
          throw new Error("Unable to load Jira tickets");
        }

        const tickets = (await ticketsResponse.json()) as JiraTicket[];

        const members = membersResponse.ok ? ((await membersResponse.json()) as JiraMember[]) : [];

        setJiraTickets(tickets);
        setJiraMembers(members);
        setPersonId((current) => current || members[0]?.account_id || "");
      } catch (error) {
        console.error(error);
        toast.error("Unable to load Jira handover data");
      } finally {
        setJiraLoading(false);
      }
    }

    void loadJiraData();
  }, []);
  return (
    <AppShell user={user} title="Handover kit">
      <PageSection>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-wide text-mute">
            Developer going on leave
          </span>
          <Select
            value={personId}
            onValueChange={(value) => {
              setPersonId(value);
              setTab("Work state");
            }}
            disabled={jiraLoading}
          >
            <SelectTrigger className="h-9 w-[240px] text-[13px]">
              <SelectValue placeholder="Select a developer" />
            </SelectTrigger>
            <SelectContent>
              {jiraMembers.map((member) => (
                <SelectItem key={member.account_id} value={member.account_id}>
                  {member.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {jiraMembers.map((member) => (
            <button
              key={member.account_id}
              type="button"
              onClick={() => {
                setPersonId(member.account_id);
                setTab("Work state");
              }}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150",
                member.account_id === personId
                  ? "bg-brand text-brand-foreground"
                  : "bg-surface-sunken text-mute hover:text-ink",
              )}
            >
              {member.name}
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3.5 py-2.5">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <p className="text-[13px] leading-relaxed text-ink">
            {selectedJiraMember ? (
              <>
                <span className="font-semibold">{person.name}</span> is selected for handover. Their
                open KPD Jira tickets will appear below.
              </>
            ) : (
              <>
                Select a developer above. The handover kit will load their real KPD Jira tickets and
                current Jira ownership.{" "}
              </>
            )}
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

      {tab === "Work state" && (
        <WorkStateTab person={person} jiraTickets={jiraTickets} leavingAccountId={personId} />
      )}
      {tab === "Assign coverage" && (
        <AssignCoverageTab
          person={person}
          firstName={firstName}
          jiraTickets={jiraTickets}
          jiraMembers={jiraMembers}
          jiraLoading={jiraLoading}
          leavingAccountId={personId}
          onTicketsChange={setJiraTickets}
        />
      )}
      {tab === "Knowledge risks" && (
        <KnowledgeRisksTab
          person={person}
          firstName={firstName}
          jiraTickets={jiraTickets}
          leavingAccountId={personId}
        />
      )}
      {tab === "Export kit" && (
        <ExportKitTab
          person={person}
          firstName={firstName}
          jiraTickets={jiraTickets}
          jiraMembers={jiraMembers}
          leavingAccountId={personId}
        />
      )}
    </AppShell>
  );
}

function WorkStateTab({
  person,
  jiraTickets,
  leavingAccountId,
}: {
  person: LeavingPerson;
  jiraTickets: JiraTicket[];
  leavingAccountId: string;
}) {
  const liveTickets = jiraTickets.filter(
    (ticket) => ticket.assignee_account_id === leavingAccountId,
  );

  const openTickets = liveTickets.filter((ticket) => ticket.status.toLowerCase() !== "done");

  const criticalTickets = openTickets.filter(
    (ticket) =>
      ticket.priority.toLowerCase() === "critical" || ticket.priority.toLowerCase() === "high",
  );

  return (
    <>
      <PageSection>
        <div className="grid grid-cols-3 gap-4">
          <MetricCard label="Open tickets" value={openTickets.length} tone="warning" />
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
          {criticalTickets.length === 0 ? (
            <p className="py-2 text-[13px] text-mute">
              No critical or high-priority open Jira tickets.
            </p>
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
                {criticalTickets.map((ticket) => (
                  <tr key={ticket.key} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3">
                      <TicketKey>{ticket.key}</TicketKey>
                    </td>

                    <td className="py-2 pr-3 text-[13px] text-ink">{ticket.summary}</td>

                    <td className="py-2 pr-3 text-[13px] text-mute">{ticket.status}</td>

                    <td className="py-2 pr-3">
                      <Chip
                        tone={ticket.priority.toLowerCase() === "critical" ? "danger" : "warning"}
                      >
                        {ticket.priority}
                      </Chip>
                    </td>

                    <td className="py-2 text-[13px] text-mute">
                      {new Date(ticket.updated).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </PageSection>

      <PageSection>
        <Panel
          title={`${person.name}'s Jira work`}
          icon={<ClipboardList className="size-3.5 text-mute" />}
        >
          {openTickets.length === 0 ? (
            <p className="py-2 text-[13px] text-mute">
              No open Jira tickets assigned to {person.name}.
            </p>
          ) : (
            <div className="max-h-[360px] overflow-y-auto space-y-2 pr-2">
              {openTickets.map((ticket) => (
                <div key={ticket.key} className="rounded-md border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <TicketKey>{ticket.key}</TicketKey>

                      <p className="mt-1 text-[13px] text-ink">{ticket.summary}</p>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full border border-border bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-mute">
                          {ticket.status}
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            ticket.priority.toLowerCase() === "critical"
                              ? "bg-red-500/15 text-red-400 border border-red-500/30"
                              : ticket.priority.toLowerCase() === "high"
                                ? "bg-orange-500/15 text-orange-400 border border-orange-500/30"
                                : ticket.priority.toLowerCase() === "medium"
                                  ? "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30"
                                  : "bg-green-500/15 text-green-400 border border-green-500/30",
                          )}
                        >
                          {ticket.priority}
                        </span>
                      </div>

                      <p className="mt-1 text-[11px] text-mute">
                        Jira owner: {ticket.assignee || "Unassigned"}
                      </p>
                    </div>

                    <span className="shrink-0 text-[11px] text-mute">Jira</span>
                  </div>
                </div>
              ))}
            </div>
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
                {person.branches.map((branch) => (
                  <li key={branch.name} className="border-b border-border py-2 last:border-0">
                    <div className="flex items-center justify-between gap-2">
                      <BranchName>{branch.name}</BranchName>

                      <Chip tone={branch.state === "mid-flight" ? "warning" : "danger"}>
                        {branch.state}
                      </Chip>
                    </div>

                    <div className="mt-0.5 text-[11px] text-mute">
                      {branch.commitsAhead} {branch.commitsAhead === 1 ? "commit" : "commits"} ahead
                      {" · "}last push {branch.lastPush}
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
              {person.recentActivity.map((activity) => (
                <li
                  key={activity.sha}
                  className="flex items-center gap-3 border-b border-border py-2 last:border-0"
                >
                  <span className="font-mono text-[12px] text-brand">{activity.sha}</span>

                  <span className="flex-grow text-[13px] text-ink">{activity.message}</span>

                  <span className="shrink-0 text-[11px] text-mute">{activity.when}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </PageSection>
    </>
  );
}

function AssignCoverageTab({
  person,
  firstName,
  jiraTickets,
  jiraMembers,
  jiraLoading,
  leavingAccountId,
  onTicketsChange,
}: {
  person: LeavingPerson;
  firstName: string;
  jiraTickets: JiraTicket[];
  jiraMembers: JiraMember[];
  jiraLoading: boolean;
  leavingAccountId: string;
  onTicketsChange: (tickets: JiraTicket[]) => void;
}) {
  const [ticketAssignee, setTicketAssignee] = useState<Record<string, string>>({});
  const [ticketUrgency, setTicketUrgency] = useState<Record<string, string>>(person.prefillUrgency);
  const [branchOwner, setBranchOwner] = useState<Record<string, string>>({});
  const [branchDecision, setBranchDecision] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [savingTicket, setSavingTicket] = useState<string | null>(null);

  const urgencyOptions = ["Critical", "High", "Medium"] as const;

  /*
   * Jira is the source of truth.
   *
   * We take the tickets currently assigned to the person who is leaving.
   * The list is kept locally after loading so that when we reassign a ticket
   * to someone else, it can remain visible in the handover coverage screen.
   */
  /*
   * Jira is the source of truth.
   *
   * Find the selected developer's real Jira account and use the stable
   * account ID to determine which KPD tickets belong to them.
   */
  const leavingMember = jiraMembers.find((member) => member.account_id === leavingAccountId);

  const [handoverTickets, setHandoverTickets] = useState<JiraTicket[]>([]);
  const initializedLeavingAccountId = useRef<string | null>(null);

  useEffect(() => {
    if (!leavingAccountId) {
      initializedLeavingAccountId.current = null;
      setHandoverTickets([]);
      setTicketAssignee({});
      return;
    }

    // Rebuild the handover list only when the selected developer changes.
    // After a ticket is reassigned, Jira data changes too, but that ticket
    // must remain visible in the handover list as an assigned item.
    if (initializedLeavingAccountId.current !== leavingAccountId) {
      initializedLeavingAccountId.current = leavingAccountId;
      setHandoverTickets(
        jiraTickets.filter((ticket) => ticket.assignee_account_id === leavingAccountId),
      );
      setTicketAssignee({});
      return;
    }

    // Pick up newly-created/reassigned-to-leaver tickets without removing
    // tickets that were already handed over to another teammate.
    setHandoverTickets((current) => {
      const currentKeys = new Set(current.map((ticket) => ticket.key));
      const newTickets = jiraTickets.filter(
        (ticket) => ticket.assignee_account_id === leavingAccountId && !currentKeys.has(ticket.key),
      );

      if (newTickets.length === 0) return current;
      return [...current, ...newTickets];
    });
  }, [jiraTickets, leavingAccountId]);

  const personTickets = handoverTickets;

  const assignedTickets = personTickets.filter((ticket) => Boolean(ticketAssignee[ticket.key]));

  const unassignedTickets = personTickets.filter((ticket) => !ticketAssignee[ticket.key]);

  async function assignTicket(ticket: JiraTicket, memberName: string) {
    const isUnassigned = memberName === "Unassigned";
    const member = isUnassigned ? null : jiraMembers.find((m) => m.name === memberName);

    if (!isUnassigned && !member) {
      toast.error(`Could not find Jira account for ${memberName}`);
      return;
    }

    if (member && member.account_id === leavingMember?.account_id) {
      toast.error("A leave developer cannot be their own replacement.");
      return;
    }

    const previousValue = ticketAssignee[ticket.key] ?? "";

    setTicketAssignee((prev) => {
      const next = { ...prev };

      if (isUnassigned) {
        delete next[ticket.key];
      } else {
        next[ticket.key] = memberName;
      }

      return next;
    });

    setSavingTicket(ticket.key);

    try {
      const response = await fetch(
        `${API_BASE}/api/handover/kpd/tickets/${encodeURIComponent(ticket.key)}/assignee`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            account_id: member?.account_id ?? null,
          }),
        },
      );

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.detail ?? "Jira assignment failed");
      }

      setHandoverTickets((currentTickets) =>
        currentTickets.map((currentTicket) =>
          currentTicket.key === ticket.key
            ? {
                ...currentTicket,
                assignee: member?.name ?? null,
                assignee_account_id: member?.account_id ?? null,
              }
            : currentTicket,
        ),
      );

      onTicketsChange(
        jiraTickets.map((currentTicket) =>
          currentTicket.key === ticket.key
            ? {
                ...currentTicket,
                assignee: member?.name ?? null,
                assignee_account_id: member?.account_id ?? null,
              }
            : currentTicket,
        ),
      );

      toast.success(
        isUnassigned
          ? `${ticket.key} is now unassigned in Jira`
          : `${ticket.key} assigned to ${member!.name} in Jira`,
      );
    } catch (error) {
      setTicketAssignee((prev) => ({
        ...prev,
        [ticket.key]: previousValue,
      }));

      toast.error(error instanceof Error ? error.message : "Unable to update Jira");
    } finally {
      setSavingTicket(null);
    }
  }

  if (jiraLoading) {
    return (
      <PageSection subtitle={`Loading ${firstName}'s live Jira tickets...`}>
        <Panel title="Ticket coverage" icon={<ClipboardList className="size-3.5 text-mute" />}>
          <p className="py-8 text-center text-[13px] text-mute">Loading tickets from Jira...</p>
        </Panel>
      </PageSection>
    );
  }

  if (!leavingAccountId) {
    return (
      <PageSection subtitle="Select a developer above to load their real KPD Jira work.">
        <Panel title="Ticket coverage" icon={<ClipboardList className="size-3.5 text-mute" />}>
          <div className="rounded-md border border-dashed border-border px-3 py-8 text-center">
            <p className="text-[13px] text-mute">Select a developer to see their Jira tickets.</p>
          </div>
        </Panel>
      </PageSection>
    );
  }

  return (
    <>
      <PageSection subtitle={`Assign each open item to a team member before ${firstName} leaves.`}>
        <Panel title="Ticket coverage" icon={<ClipboardList className="size-3.5 text-mute" />}>
          {personTickets.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-3 py-8 text-center">
              <p className="text-[13px] text-mute">
                No open Jira tickets are currently assigned to {person.name}.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Assigned */}
              <div className="rounded-lg border border-success/30 bg-success-soft/20 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-semibold text-ink">Assigned</p>
                    <p className="text-[11px] text-mute">Tickets with an owner</p>
                  </div>

                  <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success">
                    {assignedTickets.length}
                  </span>
                </div>

                <div className="max-h-[330px] overflow-y-auto space-y-2 pr-2">
                  {assignedTickets.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border px-3 py-5 text-center text-[12px] text-mute">
                      No tickets assigned yet.
                    </div>
                  ) : (
                    assignedTickets.map((t) => (
                      <div key={t.key} className="rounded-md border border-border bg-card p-3">
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <TicketKey>{t.key}</TicketKey>
                            <p className="mt-1 truncate text-[13px] text-ink">{t.summary}</p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <span className="rounded-full border border-border bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-mute">
                                {t.status}
                              </span>
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                  t.priority.toLowerCase() === "critical"
                                    ? "bg-red-500/15 text-red-400 border border-red-500/30"
                                    : t.priority.toLowerCase() === "high"
                                      ? "bg-orange-500/15 text-orange-400 border border-orange-500/30"
                                      : t.priority.toLowerCase() === "medium"
                                        ? "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30"
                                        : "bg-green-500/15 text-green-400 border border-green-500/30",
                                )}
                              >
                                {t.priority}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[11px] text-success">
                              Jira owner: {t.assignee}
                            </p>
                          </div>

                          <div className="flex shrink-0 gap-1">
                            {urgencyOptions.map((u) => (
                              <button
                                key={u}
                                type="button"
                                onClick={() =>
                                  setTicketUrgency((prev) => ({
                                    ...prev,
                                    [t.key]: u,
                                  }))
                                }
                                className={cn(
                                  "rounded-sm border px-1.5 py-0.5 text-[10px] font-medium transition-colors duration-150",
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

                        <Select
                          value={ticketAssignee[t.key] ?? ""}
                          onValueChange={(value) => void assignTicket(t, value)}
                          disabled={savingTicket === t.key}
                        >
                          <SelectTrigger className="h-8 w-full text-[12px]">
                            <SelectValue placeholder="Select team member" />
                          </SelectTrigger>

                          <SelectContent>
                            {jiraMembers
                              .filter((member) => member.account_id !== leavingMember?.account_id)
                              .map((member) => (
                                <SelectItem key={member.account_id} value={member.name}>
                                  {member.name}
                                </SelectItem>
                              ))}

                            <SelectItem value="Unassigned">Unassigned</SelectItem>
                          </SelectContent>
                        </Select>

                        {savingTicket === t.key && (
                          <p className="mt-1 text-[10px] text-mute">Updating Jira...</p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Not assigned */}
              <div className="rounded-lg border border-warning/30 bg-warning-soft/20 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-semibold text-ink">Not assigned</p>
                    <p className="text-[11px] text-mute">Tickets that still need an owner</p>
                  </div>

                  <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">
                    {unassignedTickets.length}
                  </span>
                </div>

                <div className="max-h-[330px] overflow-y-auto space-y-2 pr-2">
                  {unassignedTickets.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border px-3 py-5 text-center text-[12px] text-success">
                      All tickets have been assigned.
                    </div>
                  ) : (
                    unassignedTickets.map((t) => (
                      <div key={t.key} className="rounded-md border border-border bg-card p-3">
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <TicketKey>{t.key}</TicketKey>
                            <p className="mt-1 truncate text-[13px] text-ink">{t.summary}</p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <span className="rounded-full border border-border bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-mute">
                                {t.status}
                              </span>
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                  t.priority.toLowerCase() === "critical"
                                    ? "bg-red-500/15 text-red-400 border border-red-500/30"
                                    : t.priority.toLowerCase() === "high"
                                      ? "bg-orange-500/15 text-orange-400 border border-orange-500/30"
                                      : t.priority.toLowerCase() === "medium"
                                        ? "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30"
                                        : "bg-green-500/15 text-green-400 border border-green-500/30",
                                )}
                              >
                                {t.priority}
                              </span>
                            </div>
                          </div>

                          <div className="flex shrink-0 gap-1">
                            {urgencyOptions.map((u) => (
                              <button
                                key={u}
                                type="button"
                                onClick={() =>
                                  setTicketUrgency((prev) => ({
                                    ...prev,
                                    [t.key]: u,
                                  }))
                                }
                                className={cn(
                                  "rounded-sm border px-1.5 py-0.5 text-[10px] font-medium transition-colors duration-150",
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

                        <Select
                          value={ticketAssignee[t.key] ?? ""}
                          onValueChange={(value) => void assignTicket(t, value)}
                          disabled={savingTicket === t.key}
                        >
                          <SelectTrigger className="h-8 w-full text-[12px]">
                            <SelectValue placeholder="Select team member" />
                          </SelectTrigger>

                          <SelectContent>
                            {jiraMembers
                              .filter((member) => member.account_id !== leavingMember?.account_id)
                              .map((member) => (
                                <SelectItem key={member.account_id} value={member.name}>
                                  {member.name}
                                </SelectItem>
                              ))}

                            <SelectItem value="Unassigned">Unassigned</SelectItem>
                          </SelectContent>
                        </Select>

                        {savingTicket === t.key && (
                          <p className="mt-1 text-[10px] text-mute">Updating Jira...</p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
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
                    onValueChange={(v) =>
                      setBranchOwner((prev) => ({
                        ...prev,
                        [b.name]: v,
                      }))
                    }
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
                    onValueChange={(v) =>
                      setBranchDecision((prev) => ({
                        ...prev,
                        [b.name]: v,
                      }))
                    }
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

          <GhostButton tone="brand" onClick={notify}>
            Confirm assignments →
          </GhostButton>
        </div>
      </PageSection>
    </>
  );
}

function KnowledgeRisksTab({
  person,
  firstName,
  jiraTickets,
  leavingAccountId,
}: {
  person: LeavingPerson;
  firstName: string;
  jiraTickets: JiraTicket[];
  leavingAccountId: string;
}) {
  const liveTickets = jiraTickets.filter(
    (ticket) => ticket.assignee_account_id === leavingAccountId,
  );

  const openTickets = liveTickets.filter((ticket) => ticket.status.toLowerCase() !== "done");

  const criticalTickets = openTickets.filter(
    (ticket) =>
      ticket.priority.toLowerCase() === "critical" || ticket.priority.toLowerCase() === "high",
  );

  const documentationCoverage =
    openTickets.length === 0
      ? 100
      : Math.max(
          0,
          Math.round(((openTickets.length - criticalTickets.length) / openTickets.length) * 100),
        );

  return (
    <>
      <PageSection label={`What only ${firstName} knows — inferred from Jira work`}>
        <div className="space-y-2">
          {criticalTickets.length === 0 && openTickets.length === 0 ? (
            <div className="rounded-lg border border-border bg-card px-4 py-3">
              <p className="text-[13px] text-mute">No open Jira work was found for {firstName}.</p>
            </div>
          ) : (
            <>
              {criticalTickets.map((ticket) => (
                <div
                  key={ticket.key}
                  className="rounded-r-lg border-l-4 border-l-danger bg-card px-4 py-3 shadow-sm"
                >
                  <p className="text-[13px] font-medium text-ink">
                    🔴 {ticket.key} — {ticket.summary}
                  </p>
                  <p className="mt-0.5 pl-5 text-[12px] text-mute">
                    {ticket.priority} priority Jira work is still assigned to {firstName}. A
                    replacement owner should review this before leave.
                  </p>
                </div>
              ))}

              {openTickets
                .filter((ticket) => !criticalTickets.includes(ticket))
                .map((ticket) => (
                  <div
                    key={ticket.key}
                    className="rounded-r-lg border-l-4 border-l-warning bg-card px-4 py-3 shadow-sm"
                  >
                    <p className="text-[13px] font-medium text-ink">
                      🟡 {ticket.key} — {ticket.summary}
                    </p>
                    <p className="mt-0.5 pl-5 text-[12px] text-mute">
                      Active Jira work currently owned by {firstName}. Confirm coverage and capture
                      the current context before leave.
                    </p>
                  </div>
                ))}
            </>
          )}
        </div>
      </PageSection>

      <PageSection label="Documentation coverage">
        <Panel>
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex items-center justify-between text-[13px]">
                <span className="text-mute">Jira work coverage</span>
                <span className={cn("font-semibold", docText(documentationCoverage))}>
                  {documentationCoverage}%
                </span>
              </div>

              <div className="h-1 overflow-hidden rounded-full bg-surface-sunken">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-700",
                    docTone(documentationCoverage),
                  )}
                  style={{ width: `${documentationCoverage}%` }}
                />
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-[13px]">
                <span className="text-mute">Open Jira tickets</span>
                <span className="font-semibold text-ink">{openTickets.length}</span>
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-[13px]">
                <span className="text-mute">High/Critical tickets</span>
                <span className="font-semibold text-ink">{criticalTickets.length}</span>
              </div>
            </div>
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
            {openTickets.length === 0 ? (
              <li className="text-[13px] text-ink">No open Jira tickets require handover.</li>
            ) : (
              <>
                {criticalTickets.length > 0 && (
                  <li className="border-b border-border/60 pb-1.5 text-[13px] text-ink">
                    1. Review {criticalTickets.length} high/critical Jira ticket
                    {criticalTickets.length === 1 ? "" : "s"} with the replacement.
                  </li>
                )}

                <li className="border-b border-border/60 pb-1.5 text-[13px] text-ink">
                  2. Assign coverage for all remaining open Jira tickets.
                </li>

                <li className="border-b border-border/60 pb-1.5 text-[13px] text-ink">
                  3. Capture important context for active work before leave.
                </li>

                <li className="text-[13px] text-ink">4. Confirm the replacement owners in Jira.</li>
              </>
            )}
          </ol>
        </div>
      </PageSection>
    </>
  );
}
function ExportKitTab({
  person,
  firstName,
  jiraTickets,
  jiraMembers,
  leavingAccountId,
}: {
  person: LeavingPerson;
  firstName: string;
  jiraTickets: JiraTicket[];
  jiraMembers: JiraMember[];
  leavingAccountId: string;
}) {
  const selectedPersonName =
    person.name && person.name !== "Select a developer"
      ? person.name
      : jiraMembers.find((member) => member.account_id === leavingAccountId)?.name ||
        "Select a developer";

  const hasDeveloper = Boolean(leavingAccountId && selectedPersonName !== "Select a developer");

  /*
   * IMPORTANT:
   * Export only the tickets belonging to the outgoing developer.
   * Do not export the complete KPD board.
   */
  const outgoingTickets = hasDeveloper
    ? jiraTickets.filter((ticket) => ticket.assignee_account_id === leavingAccountId)
    : [];

  const openTickets = outgoingTickets.filter((ticket) => ticket.status.toLowerCase() !== "done");

  const criticalTickets = openTickets.filter((ticket) => {
    const priority = ticket.priority.toLowerCase();
    return priority === "high" || priority === "critical";
  });

  /*
   * These are the people who currently own the tickets after coverage
   * assignments have been made.
   */
  const incomingOwners = Array.from(
    new Set(
      openTickets
        .map((ticket) => ticket.assignee)
        .filter((name): name is string => Boolean(name) && name !== selectedPersonName),
    ),
  );

  const assignedCount = openTickets.filter(
    (ticket) => Boolean(ticket.assignee) && ticket.assignee !== selectedPersonName,
  ).length;

  const unassignedCount = openTickets.filter(
    (ticket) => !ticket.assignee || ticket.assignee === selectedPersonName,
  ).length;

  const generatedAt = new Date().toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const liveHandoverPath =
    typeof window !== "undefined"
      ? `${window.location.origin}/mgr/handover-kit`
      : "/mgr/handover-kit";

  const [recipientId, setRecipientId] = useState("");

  const recipient = jiraMembers.find((member) => member.account_id === recipientId);

  const transferFullHandover = async () => {
    console.log("🚀 TRANSFER BUTTON CLICKED");

    if (!recipientId) {
      toast.error("Please select a recipient first.");
      return;
    }

    const recipient = jiraMembers.find((member) => member.account_id === recipientId);

    if (!recipient) {
      toast.error("Recipient could not be found.");
      return;
    }

    // Resolve a stable person-page slug from the selected Jira recipient.
    // Do NOT require the recipient to already exist in the local Relay directory.
    const recipientProfile = teamMembers.find(
      (member) => member.name?.trim().toLowerCase() === recipient.name?.trim().toLowerCase(),
    );

    const recipientProfileId =
      recipientProfile?.id ??
      recipient.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    console.log("✅ RECIPIENT PAGE RESOLVED", {
      recipient: recipient.name,
      recipientProfileId,
      existingRelayProfile: Boolean(recipientProfile),
    });

    const transferredTicketKeys: string[] = [];
    const failedTicketKeys: string[] = [];

    console.log("📦 TRANSFER START", {
      recipient: recipient.name,
      recipientProfileId: recipientProfileId,
      tickets: openTickets.length,
    });

    const batchSize = 5;

    for (let i = 0; i < openTickets.length; i += batchSize) {
      const batch = openTickets.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (ticket) => {
          try {
            const response = await fetch(
              `${API_BASE}/api/handover/kpd/tickets/${encodeURIComponent(ticket.key)}/assignee`,
              {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ account_id: recipient.account_id }),
              },
            );

            if (response.ok) {
              transferredTicketKeys.push(ticket.key);
            } else {
              failedTicketKeys.push(ticket.key);
              console.error(`Failed to transfer ${ticket.key}:`, await response.text());
            }
          } catch (error) {
            failedTicketKeys.push(ticket.key);
            console.error(`Failed to transfer ${ticket.key}:`, error);
          }
        }),
      );
    }

    const transfer = {
      handoverId: `handover-${Date.now()}`,
      outgoingDeveloper: selectedPersonName,
      recipientId: recipientProfileId,
      recipientJiraAccountId: recipient.account_id,
      recipientName: recipient.name,
      generatedAt,
      source: "Relay Handover Kit",
      summary: {
        openTickets: openTickets.length,
        highCritical: criticalTickets.length,
        covered: assignedCount,
        needsCoverage: unassignedCount,
      },
      currentWork: openTickets.map((ticket) => ({
        key: ticket.key,
        summary: ticket.summary,
        status: ticket.status,
        priority: ticket.priority,
        assignee: ticket.assignee,
        updated: ticket.updated,
      })),
      incomingOwners,
      knowledge: {
        title: `Knowledge transfer from ${selectedPersonName}`,
        summary: `${selectedPersonName} handover transferred to ${recipient.name}.`,
        risks: [],
        aiHandoverSummary: `Review inherited Jira work, ownership, coverage risks, and current ticket context.`,
        askProjectPath: "/ask-project",
      },
      liveHandoverPath: `/mgr/team/${recipientProfileId}`,
    };

    localStorage.setItem(
      `relay-handover-transfer:${recipientProfileId}`,
      JSON.stringify({
        ...transfer,
        transferredAt: new Date().toISOString(),
        transferredFrom: selectedPersonName,
        transferredTicketKeys,
        transferStatus: failedTicketKeys.length ? "partial" : "completed",
        failedTicketKeys,
      }),
    );

    console.log("✅ TRANSFER SAVED", {
      transferredTicketKeys,
      failedTicketKeys,
      destination: `/mgr/team/${recipientProfileId}`,
    });

    toast.success(
      `${transferredTicketKeys.length} Jira item${
        transferredTicketKeys.length === 1 ? "" : "s"
      } transferred to ${recipient.name}.`,
    );

    setTimeout(() => {
      window.location.assign(`/mgr/team/${encodeURIComponent(recipientProfileId)}`);
    }, 300);
  };

  const copyMarkdown = async () => {
    const markdown = [
      `# Handover Snapshot — ${selectedPersonName}`,
      "",
      `Generated: ${generatedAt}`,
      "",
      "## Summary",
      `- Open tickets: ${openTickets.length}`,
      `- High / Critical: ${criticalTickets.length}`,
      `- Covered: ${assignedCount}`,
      `- Unassigned: ${unassignedCount}`,
      "",
      "## Current Work",
      ...openTickets.map(
        (ticket) =>
          `- **${ticket.key}** — ${ticket.summary} — ${ticket.status} — ${
            ticket.assignee || "Unassigned"
          }`,
      ),
      "",
      "## Incoming Owners",
      ...(incomingOwners.length
        ? incomingOwners.map((owner) => `- ${owner}`)
        : ["- No replacement owners assigned"]),
      "",
      "## Knowledge Transfer",
      `- AI handover summary: ${selectedPersonName}'s active Jira work and current ownership context.`,
      `- Ask Project: ${
        typeof window !== "undefined" ? `${window.location.origin}/ask-project` : "/ask-project"
      }`,
      "",
      "## Live Handover",
      liveHandoverPath,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(markdown);
      notifyExport();
    } catch {
      notifyExport();
    }
  };

  const exportPdf = () => {
    if (!hasDeveloper) {
      notifyExport();
      return;
    }

    window.print();
  };

  if (!hasDeveloper) {
    return (
      <div className="space-y-4">
        <PageSection>
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5">
            <div className="text-sm font-semibold text-amber-100">
              Select a developer to create the handover snapshot
            </div>
            <div className="mt-1 text-xs text-amber-100/70">
              The Export Kit will contain only that developer&apos;s open Jira work, coverage,
              risks, and final handover state.
            </div>
          </div>
        </PageSection>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Full handover transfer */}
      <PageSection>
        <div className="rounded-xl border border-brand/30 bg-brand-soft/10 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-brand">
                Transfer full handover
              </div>

              <h3 className="mt-1 text-sm font-semibold text-slate-100">
                Send {selectedPersonName}&apos;s complete handover to a teammate
              </h3>

              <p className="mt-1 max-w-2xl text-[11px] leading-5 text-slate-400">
                Transfers current Jira work, ownership context, coverage risks, and an AI-generated
                handover summary to the recipient&apos;s profile.
              </p>
            </div>

            <div className="flex w-full shrink-0 flex-col gap-2 sm:flex-row lg:w-auto">
              <Select value={recipientId} onValueChange={setRecipientId}>
                <SelectTrigger className="h-9 w-full text-[12px] sm:w-[190px]">
                  <SelectValue placeholder="Select recipient" />
                </SelectTrigger>

                <SelectContent>
                  {jiraMembers
                    .filter((member) => member.account_id !== leavingAccountId)
                    .map((member) => (
                      <SelectItem key={member.account_id} value={member.account_id}>
                        {member.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>

              <button
                type="button"
                aria-label="Transfer full handover"
                onClick={() => {
                  void transferFullHandover();
                }}
                className="relative z-[999999] inline-flex h-9 cursor-pointer pointer-events-auto select-none items-center justify-center rounded-md border border-slate-500 bg-slate-800 px-4 text-[12px] font-semibold text-slate-100 opacity-100 shadow-sm transition hover:bg-slate-700 active:scale-[0.98]"
                style={{
                  pointerEvents: "auto",
                  position: "relative",
                  zIndex: 999999,
                  cursor: "pointer",
                  opacity: 1,
                }}
              >
                Transfer full handover →
              </button>
            </div>
          </div>
        </div>
      </PageSection>

      {/* Snapshot header */}
      <PageSection>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded-full border border-slate-600 bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                Frozen copy
              </span>

              <button
                type="button"
                onClick={exportPdf}
                className="cursor-pointer text-xs font-medium text-brand hover:underline"
              >
                Handover Snapshot
              </button>
            </div>

            <h2 className="text-xl font-semibold text-slate-100">
              {selectedPersonName} — Handover Export
            </h2>

            <p className="mt-1 text-xs text-slate-400">Generated {generatedAt}</p>
          </div>

          <div className="text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Handover date
            </div>
            <div className="mt-1 text-sm font-medium text-slate-300">{person.leavingDate}</div>
          </div>
        </div>
      </PageSection>

      {/* Snapshot metadata */}
      <PageSection>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Snapshot type
            </div>
            <div className="mt-1 text-xs font-medium text-slate-200">Dated & frozen</div>
            <div className="mt-1 text-[10px] text-slate-500">
              This copy will not update after export.
            </div>
          </div>

          <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Outgoing developer
            </div>
            <div className="mt-1 text-xs font-medium text-slate-200">{selectedPersonName}</div>
            <div className="mt-1 text-[10px] text-slate-500">
              Handover date: {person.leavingDate}
            </div>
          </div>

          <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Source
            </div>
            <div className="mt-1 text-xs font-medium text-slate-200">Live Jira state</div>
            <div className="mt-1 text-[10px] text-slate-500">Captured at {generatedAt}</div>
          </div>
        </div>
      </PageSection>

      {/* Summary metrics */}
      <PageSection>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Handover overview</h3>
            <p className="mt-1 text-[11px] text-slate-500">
              Review the transfer state before exporting the frozen snapshot.
            </p>
          </div>

          {unassignedCount > 0 && (
            <GhostButton
              tone="brand"
              onClick={() => {
                toast("Open the Assign coverage tab to assign replacement owners.");
                const tabButton = Array.from(document.querySelectorAll("button")).find(
                  (button) => button.textContent?.trim() === "Assign coverage",
                );
                tabButton?.click();
              }}
            >
              Assign coverage →
            </GhostButton>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="relative z-[99999] rounded-xl border border-slate-700 bg-slate-900/60 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Open tickets
            </div>
            <div className="mt-1 text-2xl font-semibold text-slate-100">{openTickets.length}</div>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              High / Critical
            </div>
            <div className="mt-1 text-2xl font-semibold text-slate-100">
              {criticalTickets.length}
            </div>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Covered
            </div>
            <div className="mt-1 text-2xl font-semibold text-slate-100">{assignedCount}</div>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Needs coverage
            </div>
            <div className="mt-1 text-2xl font-semibold text-slate-100">{unassignedCount}</div>
          </div>
        </div>
      </PageSection>

      {/* Main handover information */}
      <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
        {/* Current work */}
        <PageSection>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Current work state</h3>
              <p className="mt-1 text-xs text-slate-500">Open Jira work owned by {firstName}.</p>
            </div>

            <span className="text-xs text-slate-500">{openTickets.length} open</span>
          </div>

          <div className="mt-3 max-h-[360px] space-y-2 overflow-y-auto pr-1">
            {openTickets.length === 0 ? (
              <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4 text-xs text-slate-400">
                No open Jira tickets are currently assigned to this developer.
              </div>
            ) : (
              openTickets.map((ticket) => {
                const covered = Boolean(ticket.assignee) && ticket.assignee !== selectedPersonName;

                return (
                  <div
                    key={ticket.key}
                    className="rounded-lg border border-slate-700 bg-slate-900/60 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold text-slate-400">
                            {ticket.key}
                          </span>

                          <span className="truncate text-sm font-medium text-slate-200">
                            {ticket.summary}
                          </span>
                        </div>

                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
                          <span>{ticket.status}</span>
                          <span>{ticket.priority}</span>
                          <span>Updated {ticket.updated}</span>
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <div
                          className={
                            covered
                              ? "text-[10px] font-semibold text-emerald-300"
                              : "text-[10px] font-semibold text-amber-300"
                          }
                        >
                          {covered ? "Covered" : "Needs coverage"}
                        </div>

                        <div className="mt-1 max-w-[120px] truncate text-[10px] text-slate-500">
                          {covered ? ticket.assignee : "No replacement owner"}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </PageSection>

        {/* Ownership */}
        <PageSection>
          <h3 className="text-sm font-semibold text-slate-100">Ownership & coverage</h3>

          <p className="mt-1 text-xs text-slate-500">
            Replacement ownership captured from the current Jira state.
          </p>

          <div className="mt-3 space-y-2">
            {incomingOwners.length === 0 ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                  Coverage required
                </div>
                <div className="mt-1 text-xs text-amber-100/80">
                  No replacement owner has been assigned to the open work yet.
                </div>
              </div>
            ) : (
              incomingOwners.map((owner) => {
                const ownerTickets = openTickets.filter(
                  (ticket) => ticket.assignee === owner,
                ).length;

                return (
                  <div
                    key={owner}
                    className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2.5"
                  >
                    <span className="text-xs font-medium text-slate-200">{owner}</span>

                    <span className="text-[10px] text-slate-500">
                      {ownerTickets} {ownerTickets === 1 ? "ticket" : "tickets"}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <div
            className={
              unassignedCount > 0
                ? "mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3"
                : "mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3"
            }
          >
            <div className="text-[10px] font-semibold uppercase tracking-wider">
              {unassignedCount > 0 ? "Coverage risk" : "Coverage status"}
            </div>

            <div className="mt-1 text-xs text-slate-300">
              {unassignedCount > 0
                ? `${unassignedCount} open ${
                    unassignedCount === 1 ? "ticket needs" : "tickets need"
                  } a replacement owner.`
                : "All open tickets have replacement ownership."}
            </div>
          </div>
        </PageSection>
      </div>

      {/* Risk + notes */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PageSection>
          <h3 className="text-sm font-semibold text-slate-100">Knowledge & coverage risks</h3>

          <div className="mt-3 space-y-2">
            {criticalTickets.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <div className="text-xs font-semibold text-amber-200">High / Critical work</div>
                <div className="mt-1 text-[11px] text-amber-100/70">
                  {criticalTickets.length} open high-priority or critical Jira{" "}
                  {criticalTickets.length === 1 ? "item requires" : "items require"} explicit
                  coverage.
                </div>
              </div>
            )}

            {unassignedCount > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <div className="text-xs font-semibold text-amber-200">Ownership gap</div>
                <div className="mt-1 text-[11px] text-amber-100/70">
                  {unassignedCount} open {unassignedCount === 1 ? "item has" : "items have"} no
                  replacement owner.
                </div>
              </div>
            )}

            {criticalTickets.length === 0 && unassignedCount === 0 && (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                <div className="text-xs font-semibold text-emerald-200">
                  No immediate coverage gaps
                </div>
                <div className="mt-1 text-[11px] text-slate-400">
                  Current Jira ownership provides coverage for all open work.
                </div>
              </div>
            )}

            <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Knowledge concentration
              </div>

              <div className="mt-1 text-xs text-slate-300">
                {openTickets.length === 0
                  ? "No active Jira work requires knowledge transfer."
                  : `${openTickets.length} active Jira item${
                      openTickets.length === 1 ? "" : "s"
                    } require${openTickets.length === 1 ? "s" : ""} handover context.`}
              </div>

              <div className="mt-2 text-[10px] text-slate-500">
                Bus-factor calculation will be sourced from live module ownership when the handover
                backend is enabled.
              </div>
            </div>
          </div>
        </PageSection>

        <PageSection>
          <h3 className="text-sm font-semibold text-slate-100">Approved handover notes</h3>

          <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900/50 p-4">
            <div className="text-xs font-medium text-slate-300">No approved notes recorded</div>

            <div className="mt-1 text-[11px] leading-5 text-slate-500">
              Notes should appear here only after they have been approved for inclusion in the
              frozen handover snapshot.
            </div>
          </div>
        </PageSection>
      </div>

      {/* Live link */}
      <PageSection>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Live Handover Kit</h3>

            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
              This export is a frozen snapshot. The live Handover Kit remains the source of truth
              for current ownership, ticket status and permissions.
            </p>
          </div>

          <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Live link
            </div>
            <a
              href={liveHandoverPath}
              className="mt-1 block text-xs font-medium text-brand hover:underline"
            >
              Open live Handover Kit →
            </a>
          </div>
        </div>
      </PageSection>

      {/* Export actions */}
      <PageSection>
        <div className="flex flex-wrap gap-2">
          <GhostButton
            tone="brand"
            onClick={() => {
              window.print();
            }}
          >
            Preview full kit
          </GhostButton>

          <GhostButton onClick={copyMarkdown}>Copy as Markdown</GhostButton>

          <GhostButton onClick={exportPdf}>Export PDF</GhostButton>
        </div>

        <p className="mt-2 text-[10px] text-slate-500">
          PDF export creates a dated frozen copy of the current handover state.
        </p>
      </PageSection>
    </div>
  );
}
