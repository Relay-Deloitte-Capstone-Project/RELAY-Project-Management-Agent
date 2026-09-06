import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/relay/AppShell";
import { Avatar, Chip, PageSection, Panel } from "@/components/relay/primitives";
import { allUsers } from "@/lib/mockData";
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

function AllUsers() {
  const { user } = Route.useRouteContext();
  return (
    <AppShell user={user} title="All users">
      <PageSection label="Users" subtitle="Across every project connected to this workspace.">
        <Panel>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="section-label">User</TableHead>
                <TableHead className="section-label">Role</TableHead>
                <TableHead className="section-label">Projects</TableHead>
                <TableHead className="section-label">Status</TableHead>
                <TableHead className="section-label">Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allUsers.map((u) => (
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
                  <TableCell className="text-[13px] text-mute">{u.projects}</TableCell>
                  <TableCell>
                    <Chip tone={u.status === "Active" ? "success" : "warning"}>{u.status}</Chip>
                  </TableCell>
                  <TableCell className="text-[13px] text-mute">{u.lastSeen}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      </PageSection>
    </AppShell>
  );
}
