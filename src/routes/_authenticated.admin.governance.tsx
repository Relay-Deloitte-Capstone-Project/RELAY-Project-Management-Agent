import { createFileRoute } from "@tanstack/react-router";
import { FileDown, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import { GhostButton, PageSection, Panel } from "@/components/relay/primitives";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  addMockCertificate,
  archiveMockProject,
  mockCertificates,
  mockProjects,
  type MockProject,
} from "@/lib/admin/mockProjects";

export const Route = createFileRoute("/_authenticated/admin/governance")({
  head: () => ({
    meta: [
      { title: "Data governance — Relay" },
      {
        name: "description",
        content:
          "Retention status for active projects and destruction certificates for offboarded ones.",
      },
      { property: "og:title", content: "Data governance — Relay" },
      {
        property: "og:description",
        content: "Retention, offboarding and destruction certificates.",
      },
    ],
  }),
  component: DataGovernance,
});

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function DataGovernance() {
  const { user } = Route.useRouteContext();
  const [projects, setProjects] = useState(() => [...mockProjects]);
  const [certificates, setCertificates] = useState(() => [...mockCertificates]);
  const [target, setTarget] = useState<MockProject | null>(null);
  const [confirmReturned, setConfirmReturned] = useState(false);
  const [confirmPattern, setConfirmPattern] = useState(false);
  const [destroying, setDestroying] = useState(false);

  function openOffboard(p: MockProject) {
    setTarget(p);
    setConfirmReturned(false);
    setConfirmPattern(false);
  }

  function runDestruction() {
    if (!target) return;
    setDestroying(true);
    window.setTimeout(() => {
      const chunksDeleted = Math.floor(1500 + Math.random() * 6000);
      archiveMockProject(target.id);
      addMockCertificate({
        id: `cert-${Date.now()}`,
        projectName: `${target.name} — engagement`,
        destroyedAt: new Date().toISOString().slice(0, 10),
        chunksDeleted,
        certifiedBy: user.name,
      });
      setProjects([...mockProjects]);
      setCertificates([...mockCertificates]);
      setDestroying(false);
      setTarget(null);
    }, 1200);
  }

  const activeProjects = projects.filter((p) => p.status !== "archived");

  return (
    <AppShell user={user} title="Data governance">
      <PageSection
        label="Active projects"
        subtitle="Retention status for every non-archived engagement."
      >
        <Panel>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="section-label">Project</TableHead>
                <TableHead className="section-label">Retention</TableHead>
                <TableHead className="section-label">Contract end</TableHead>
                <TableHead className="section-label">Status</TableHead>
                <TableHead className="section-label" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeProjects.map((p) => (
                <TableRow key={p.id} className="h-10">
                  <TableCell className="text-[13px] text-ink">{p.name}</TableCell>
                  <TableCell className="text-[13px] text-mute">
                    {p.retentionDays !== null ? `${p.retentionDays} days` : "indefinite"}
                  </TableCell>
                  <TableCell className="text-[13px] text-mute">
                    {formatDate(p.contractEnd)}
                  </TableCell>
                  <TableCell>
                    <span className="rounded-sm bg-success-soft px-1.5 py-0.5 text-[11px] font-semibold text-success">
                      Active
                    </span>
                  </TableCell>
                  <TableCell>
                    {p.retentionDays !== null ? (
                      <GhostButton tone="danger" onClick={() => openOffboard(p)}>
                        Begin offboarding
                      </GhostButton>
                    ) : (
                      <span className="text-[12px] text-mute">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      </PageSection>

      <PageSection
        label="Destroyed projects"
        subtitle="Certificates of destruction, issued on offboarding completion."
      >
        {certificates.length === 0 ? (
          <Panel>
            <p className="text-[13px] text-mute">No projects have been offboarded yet.</p>
          </Panel>
        ) : (
          <div className="flex flex-col gap-3">
            {certificates.map((c) => (
              <Panel key={c.id}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className="size-4 shrink-0 text-success" />
                    <div>
                      <div className="text-[13px] font-semibold text-ink">{c.projectName}</div>
                      <div className="text-[11.5px] text-mute">
                        Destroyed: {formatDate(c.destroyedAt)} · {c.chunksDeleted.toLocaleString()}{" "}
                        chunks deleted · Certified by: {c.certifiedBy}
                      </div>
                    </div>
                  </div>
                  <GhostButton>
                    <FileDown /> Download certificate
                  </GhostButton>
                </div>
              </Panel>
            ))}
          </div>
        )}
      </PageSection>

      <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-[14px]">Offboard {target?.name}</DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed">
              You are about to begin the offboarding process for {target?.name}. This will:
            </DialogDescription>
          </DialogHeader>
          <ol className="list-decimal pl-5 text-[13px] leading-relaxed text-mute">
            <li>Return all data to the client (you confirm this was done)</li>
            <li>Extract a 5-field structural pattern (you review it)</li>
            <li>Delete all raw tickets, commits, PRs, embeddings, and chat history</li>
            <li>Issue a Certificate of Destruction</li>
          </ol>
          <p className="text-[12.5px] font-semibold text-danger">This cannot be undone.</p>

          <div className="flex flex-col gap-2.5">
            <label className="flex items-center gap-2 text-[13px] text-ink">
              <Checkbox
                checked={confirmReturned}
                onCheckedChange={(v) => setConfirmReturned(v === true)}
              />
              I confirm client data has been returned
            </label>
            <label className="flex items-center gap-2 text-[13px] text-ink">
              <Checkbox
                checked={confirmPattern}
                onCheckedChange={(v) => setConfirmPattern(v === true)}
              />
              I have reviewed the extracted pattern
            </label>
          </div>

          <DialogFooter>
            <GhostButton onClick={() => setTarget(null)} disabled={destroying}>
              Cancel
            </GhostButton>
            <GhostButton
              tone="danger"
              onClick={runDestruction}
              disabled={!confirmReturned || !confirmPattern || destroying}
            >
              {destroying ? "Destroying…" : "Begin destruction cascade"}
            </GhostButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
