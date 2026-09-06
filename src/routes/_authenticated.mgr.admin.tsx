import { createFileRoute } from "@tanstack/react-router";
import { Check, RefreshCw, ShieldAlert, X } from "lucide-react";
import { AppShell } from "@/components/relay/AppShell";
import { GhostButton, LegalNote, PageSection, Panel } from "@/components/relay/primitives";
import { permissions, secretFindings } from "@/lib/mockData";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/mgr/admin")({
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
  component: ManagerAdmin,
});

function ManagerAdmin() {
  const { user } = Route.useRouteContext();
  return (
    <AppShell user={user} title="Access control">
      <PageSection label="Permissions" subtitle="Last synced 2 min ago.">
        <Panel
          title="Team permissions"
          action={
            <GhostButton>
              <RefreshCw /> Sync now
            </GhostButton>
          }
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="section-label">User</TableHead>
                <TableHead className="section-label">Role</TableHead>
                <TableHead className="section-label">Jira access</TableHead>
                <TableHead className="section-label">GitHub access</TableHead>
                <TableHead className="section-label">Last sync</TableHead>
                <TableHead className="section-label" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {permissions.map((p) => (
                <TableRow key={p.user} className="h-10">
                  <TableCell className="text-[13px] text-ink">{p.user}</TableCell>
                  <TableCell className="text-[13px] text-mute">{p.role}</TableCell>
                  <TableCell>
                    {p.jira ? (
                      <Check className="size-3.5 text-success" />
                    ) : (
                      <X className="size-3.5 text-danger" />
                    )}
                  </TableCell>
                  <TableCell>
                    {p.github ? (
                      <Check className="size-3.5 text-success" />
                    ) : (
                      <X className="size-3.5 text-danger" />
                    )}
                  </TableCell>
                  <TableCell className="text-[13px] text-mute">{p.lastSync}</TableCell>
                  <TableCell>
                    <GhostButton tone="danger">Revoke</GhostButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-3">
            <LegalNote>
              Permissions sync automatically every 5 minutes. Revoking takes effect on the next
              query.
            </LegalNote>
          </div>
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
