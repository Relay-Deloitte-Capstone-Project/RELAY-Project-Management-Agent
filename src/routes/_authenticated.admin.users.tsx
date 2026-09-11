import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy, Loader2, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import {
  Avatar,
  Chip,
  GhostButton,
  MetricCard,
  PageSection,
  Panel,
} from "@/components/relay/primitives";
import { listAppUsers } from "@/lib/admin/functions";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({
    meta: [
      { title: "All users — Relay" },
      {
        name: "description",
        content: "Every person with access to Relay across all connected projects.",
      },
      { property: "og:title", content: "All users — Relay" },
      { property: "og:description", content: "Roles, project counts and last activity." },
    ],
  }),
  component: AllUsers,
});

type AppUser = {
  name: string;
  initials: string;
  email: string;
  role: string;
  project: string;
  status: string;
  lastSeen: string;
};

function formatLastSeen(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function AllUsers() {
  const { user } = Route.useRouteContext();
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invited, setInvited] = useState<AppUser[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("Developer");
  const [sentInvite, setSentInvite] = useState<{ email: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await listAppUsers();
        if (!cancelled) setUsers(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Couldn't load users.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const allRows = users ? [...users, ...invited] : null;
  const activeCount = allRows?.filter((u) => u.status === "Active").length ?? 0;
  const inactiveCount = allRows ? allRows.length - activeCount : 0;

  function initialsOf(name: string) {
    return name
      .split(" ")
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }

  function sendInvite() {
    if (!inviteName.trim() || !inviteEmail.trim()) return;
    const newUser: AppUser = {
      name: inviteName.trim(),
      initials: initialsOf(inviteName.trim()),
      email: inviteEmail.trim(),
      role: inviteRole,
      project: "Relay-Deloitte Capstone",
      status: "Active",
      lastSeen: new Date().toISOString(),
    };
    setInvited((prev) => [...prev, newUser]);
    setSentInvite({ email: newUser.email });
    setInviteName("");
    setInviteEmail("");
    setInviteRole("Developer");
    setCopied(false);
  }

  function closeInvite(open: boolean) {
    setInviteOpen(open);
    if (!open) setSentInvite(null);
  }

  return (
    <AppShell user={user} title="All users">
      <PageSection label="Users" subtitle="Real accounts in this Relay workspace.">
        <div className="mb-3 grid grid-cols-3 gap-3">
          <MetricCard label="Total users" value={allRows?.length ?? "—"} />
          <MetricCard label="Active (7d)" value={activeCount || "—"} tone="success" />
          <MetricCard label="Inactive" value={inactiveCount} tone="neutral" />
        </div>

        <div className="mb-3 flex justify-end">
          <Dialog open={inviteOpen} onOpenChange={closeInvite}>
            <GhostButton tone="brand" onClick={() => setInviteOpen(true)}>
              <UserPlus /> Invite user
            </GhostButton>
            <DialogContent>
              {!sentInvite ? (
                <>
                  <DialogHeader>
                    <DialogTitle className="text-[14px]">Invite a new user</DialogTitle>
                    <DialogDescription className="text-[13px]">
                      Admin role gives system-wide access.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="flex flex-col gap-3">
                    <Input
                      placeholder="Name"
                      value={inviteName}
                      onChange={(e) => setInviteName(e.target.value)}
                    />
                    <Input
                      type="email"
                      placeholder="Email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                    />
                    <Select value={inviteRole} onValueChange={setInviteRole}>
                      <SelectTrigger className="h-9 text-[13px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Developer">Developer</SelectItem>
                        <SelectItem value="Manager">Manager</SelectItem>
                        <SelectItem value="Admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <DialogFooter>
                    <GhostButton
                      tone="brand"
                      onClick={sendInvite}
                      disabled={!inviteName.trim() || !inviteEmail.trim()}
                    >
                      Send invite
                    </GhostButton>
                  </DialogFooter>
                </>
              ) : (
                <>
                  <DialogHeader>
                    <DialogTitle className="text-[14px] flex items-center gap-1.5">
                      <Check className="size-4 text-success" /> Invite sent
                    </DialogTitle>
                    <DialogDescription className="text-[13px]">
                      Temporary password: <span className="font-mono text-ink">relay2026</span> — no
                      email is actually sent in this demo.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="flex items-center gap-2 rounded-md bg-surface-sunken px-3 py-2">
                    <span className="flex-grow font-mono text-[13px] text-ink">
                      {sentInvite.email}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(sentInvite.email).catch(() => {});
                        setCopied(true);
                      }}
                      className="text-mute hover:text-ink"
                    >
                      {copied ? (
                        <Check className="size-3.5 text-success" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </button>
                  </div>
                  <DialogFooter>
                    <GhostButton onClick={() => closeInvite(false)}>Done</GhostButton>
                  </DialogFooter>
                </>
              )}
            </DialogContent>
          </Dialog>
        </div>

        <Panel>
          {error && <p className="p-3 text-[13px] text-danger">{error}</p>}
          {!error && !users && (
            <div className="flex items-center gap-2 p-3 text-[13px] text-mute">
              <Loader2 className="size-3.5 animate-spin" /> Loading users…
            </div>
          )}
          {users && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="section-label">User</TableHead>
                  <TableHead className="section-label">Role</TableHead>
                  <TableHead className="section-label">Project</TableHead>
                  <TableHead className="section-label">Status</TableHead>
                  <TableHead className="section-label">Last seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.email} className="h-10">
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar initials={u.initials} size={24} />
                        <div>
                          <div className="text-[13px] text-ink">{u.name}</div>
                          <div className="text-[11px] text-mute">{u.email}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-[13px] text-mute">{u.role}</TableCell>
                    <TableCell className="text-[13px] text-mute">{u.project}</TableCell>
                    <TableCell>
                      <Chip tone={u.status === "Active" ? "success" : "warning"}>{u.status}</Chip>
                    </TableCell>
                    <TableCell className="text-[13px] text-mute">
                      {formatLastSeen(u.lastSeen)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      </PageSection>
    </AppShell>
  );
}
