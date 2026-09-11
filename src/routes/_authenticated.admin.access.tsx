import { createFileRoute } from "@tanstack/react-router";
import { Check, Loader2, RefreshCw, ShieldAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import { GhostButton, LegalNote, PageSection, Panel } from "@/components/relay/primitives";
import { listAppUsers } from "@/lib/admin/functions";
import { permissions as mockPermissions, secretFindings } from "@/lib/mockData";
import { mockProjects } from "@/lib/admin/mockProjects";
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

export const Route = createFileRoute("/_authenticated/admin/access")({
  head: () => ({
    meta: [
      { title: "Access control — Relay" },
      {
        name: "description",
        content:
          "Who has access to this project's Jira and GitHub data, and any credentials found in commit history.",
      },
      { property: "og:title", content: "Access control — Relay" },
      {
        property: "og:description",
        content: "Permissions sync status and Gitleaks findings for this project.",
      },
    ],
  }),
  component: AdminAccess,
});

type AppUser = { name: string; role: string };

function AdminAccess() {
  const { user } = Route.useRouteContext();
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState(mockProjects[0]?.id ?? "kafka");
  const [revoked, setRevoked] = useState<Record<string, boolean>>({});
  const isKafka = projectId === "kafka";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await listAppUsers();
        if (!cancelled) setUsers(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load permissions.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell user={user} title="Access control">
      <PageSection
        label="Permissions"
        subtitle="Who has access to this project's Jira and GitHub data."
      >
        <div className="mb-3 flex items-center justify-between">
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="h-8 w-52 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {mockProjects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Panel
          title="Team permissions"
          action={
            <GhostButton>
              <RefreshCw /> Sync now
            </GhostButton>
          }
        >
          {isKafka ? (
            <>
              {error && <p className="p-3 text-[13px] text-danger">{error}</p>}
              {!users && !error && (
                <div className="flex items-center gap-2 p-3 text-[13px] text-mute">
                  <Loader2 className="size-3.5 animate-spin" /> Loading…
                </div>
              )}
              {users && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="section-label">User</TableHead>
                      <TableHead className="section-label">Role</TableHead>
                      <TableHead className="section-label">Jira access</TableHead>
                      <TableHead className="section-label">GitHub access</TableHead>
                      <TableHead className="section-label" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((p) => (
                      <TableRow key={p.name} className="h-10">
                        <TableCell className="text-[13px] text-ink">{p.name}</TableCell>
                        <TableCell className="text-[13px] text-mute">{p.role}</TableCell>
                        <TableCell>
                          {revoked[p.name] ? (
                            <X className="size-3.5 text-danger" />
                          ) : (
                            <Check className="size-3.5 text-success" />
                          )}
                        </TableCell>
                        <TableCell>
                          <X className="size-3.5 text-danger" />
                        </TableCell>
                        <TableCell>
                          <GhostButton
                            tone="danger"
                            onClick={() => setRevoked((prev) => ({ ...prev, [p.name]: true }))}
                            disabled={Boolean(revoked[p.name])}
                          >
                            {revoked[p.name] ? "Revoked" : "Revoke"}
                          </GhostButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <div className="mt-3">
                <LegalNote>
                  Jira access reflects real Jira project membership. GitHub is not connected for
                  anyone yet.
                </LegalNote>
              </div>
            </>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="section-label">User</TableHead>
                    <TableHead className="section-label">Jira access</TableHead>
                    <TableHead className="section-label">GitHub access</TableHead>
                    <TableHead className="section-label">Last synced</TableHead>
                    <TableHead className="section-label" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mockPermissions.map((p) => (
                    <TableRow key={p.user} className="h-10">
                      <TableCell className="text-[13px] text-ink">{p.user}</TableCell>
                      <TableCell>
                        {revoked[p.user] || !p.jira ? (
                          <X className="size-3.5 text-danger" />
                        ) : (
                          <Check className="size-3.5 text-success" />
                        )}
                      </TableCell>
                      <TableCell>
                        {revoked[p.user] || !p.github ? (
                          <X className="size-3.5 text-danger" />
                        ) : (
                          <Check className="size-3.5 text-success" />
                        )}
                      </TableCell>
                      <TableCell className="text-[13px] text-mute">{p.lastSync}</TableCell>
                      <TableCell>
                        <GhostButton
                          tone="danger"
                          onClick={() => setRevoked((prev) => ({ ...prev, [p.user]: true }))}
                          disabled={Boolean(revoked[p.user])}
                        >
                          {revoked[p.user] ? "Revoked" : "Revoke"}
                        </GhostButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-3">
                <LegalNote>Sample permissions data for this project.</LegalNote>
              </div>
            </>
          )}
        </Panel>
      </PageSection>

      <PageSection>
        <Panel
          title="Credentials found in commit history (Gitleaks)"
          icon={<ShieldAlert className="size-3.5 text-danger" />}
        >
          <p className="mb-3 text-[13px] text-mute">
            These were committed to the repository history. They should be rotated immediately.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="section-label">Detector</TableHead>
                <TableHead className="section-label">File</TableHead>
                <TableHead className="section-label">Commit SHA</TableHead>
                <TableHead className="section-label">Found</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {secretFindings.map((s) => (
                <TableRow key={s.sha} className="h-10">
                  <TableCell className="text-[13px] text-ink">{s.detector}</TableCell>
                  <TableCell className="font-mono text-[13px] text-mute">{s.file}</TableCell>
                  <TableCell className="font-mono text-[13px] text-mute">{s.sha}</TableCell>
                  <TableCell className="text-[13px] text-mute">{s.found}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-3">
            <LegalNote>
              Secret values are never stored — only detector type, file path, and commit SHA.
            </LegalNote>
          </div>
        </Panel>
      </PageSection>
    </AppShell>
  );
}
