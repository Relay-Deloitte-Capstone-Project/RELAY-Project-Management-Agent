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

const API_BASE = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";
function HandoverKit() {
  const { user } = Route.useRouteContext();
  const [personId, setPersonId] = useState<string>("");
  const [tab, setTab] = useState<Tab>("Work state");
  const [jiraTickets, setJiraTickets] = useState<JiraTicket[]>([]);
  const [jiraMembers, setJiraMembers] = useState<JiraMember[]>([]);
  const [jiraLoading, setJiraLoading] = useState(true);

  const selectedJiraMember = jiraMembers.find((member) => member.account_id === personId);
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
      {tab === "Export kit" && <ExportKitTab />}
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
            <div className="space-y-2">
              {openTickets.map((ticket) => (
                <div key={ticket.key} className="rounded-md border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <TicketKey>{ticket.key}</TicketKey>

                      <p className="mt-1 text-[13px] text-ink">{ticket.summary}</p>

                      <p className="mt-1 text-[11px] text-mute">
                        Status: {ticket.status} · Priority: {ticket.priority}
                      </p>

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

                <div className="space-y-2">
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
                            <p className="mt-0.5 text-[11px] text-mute">Jira status: {t.status}</p>
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

                <div className="space-y-2">
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
                            <p className="mt-0.5 text-[11px] text-mute">Jira status: {t.status}</p>
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
