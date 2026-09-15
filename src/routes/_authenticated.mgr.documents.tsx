import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Check, FolderInput, Loader2, RotateCcw, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/relay/AppShell";
import { Chip, EmptyState, GhostButton, PageSection } from "@/components/relay/primitives";
import { DocumentReviewDrawer } from "@/components/relay/DocumentReviewDrawer";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMyProject } from "@/lib/admin/useMyProject";
import {
  DOC_TYPE_LABEL,
  PM_DOC_TYPES,
  listDocuments,
  uploadDocuments,
  type IngestionStatus,
  type PmDocument,
} from "@/lib/admin/pmDocuments";

// Same ingestion pipeline and UI as /admin/documents (backend/api/documents.py,
// lib/admin/pmDocuments.ts, DocumentReviewDrawer) — the only real difference
// is scope. Admin manages every project's documents and picks one from a
// switcher; a manager only ever sees their own, resolved via useMyProject
// the same way /mgr/dashboard and other manager pages do, so there's no
// cross-project picker here at all.
export const Route = createFileRoute("/_authenticated/mgr/documents")({
  head: () => ({
    meta: [
      { title: "PM documents — Relay" },
      { name: "description", content: "Ingest and review project-knowledge documents beyond Jira/GitHub/SOW." },
    ],
  }),
  component: DocumentsWorkspace,
});

const STATUS_META: Record<IngestionStatus, { label: string; tone: "success" | "warning" | "danger" | "neutral" | "brand" }> = {
  uploaded: { label: "Uploaded", tone: "neutral" },
  classifying: { label: "Classifying…", tone: "brand" },
  needs_review: { label: "Needs review", tone: "warning" },
  confirmed: { label: "Confirmed", tone: "success" },
  rejected: { label: "Rejected", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
};

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "needs_review", label: "Needs review" },
  { value: "confirmed", label: "Confirmed" },
  { value: "failed", label: "Failed" },
  { value: "rejected", label: "Rejected" },
];

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function DocCard({ doc, onOpen }: { doc: PmDocument; onOpen: () => void }) {
  const meta = STATUS_META[doc.ingestion_status];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3.5 text-left transition-colors duration-150 hover:border-brand"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink">
            {doc.doc_id || DOC_TYPE_LABEL[doc.doc_type]}
          </div>
          <div className="mt-0.5 truncate text-[11.5px] text-mute">{doc.source_file_name}</div>
        </div>
        {doc.needs_attention && <AlertTriangle className="size-4 shrink-0 text-warning" />}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tone="violet">{DOC_TYPE_LABEL[doc.doc_type]}</Chip>
        <Chip tone={meta.tone}>{meta.label}</Chip>
        {doc.is_latest && doc.ingestion_status === "confirmed" && <Chip tone="success">Latest</Chip>}
        {!doc.is_latest && doc.ingestion_status === "confirmed" && <Chip tone="neutral">Superseded</Chip>}
      </div>
      <div className="flex items-center justify-between text-[11px] text-mute">
        <span>{doc.author || "Unknown author"}</span>
        <span>{formatDate(doc.doc_date || doc.uploaded_at)}</span>
      </div>
    </button>
  );
}

function DocumentsWorkspace() {
  const { user } = Route.useRouteContext();
  const { project, loading: projectLoading, error: projectError } = useMyProject(user.email);
  const engagementId = project?.engagement_id ?? null;

  const [docs, setDocs] = useState<PmDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [selected, setSelected] = useState<PmDocument | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const loadDocs = useCallback(() => {
    if (!engagementId) return Promise.resolve();
    setLoading(true);
    return listDocuments(engagementId, {
      ingestion_status: statusFilter || undefined,
      doc_type: typeFilter || undefined,
    })
      .then(setDocs)
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, [engagementId, statusFilter, typeFilter]);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  async function handleFiles(files: FileList | File[]) {
    if (!engagementId) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const ingested = await uploadDocuments(engagementId, list, user.email || user.name);
      const failed = ingested.filter((d) => d.ingestion_status === "failed");
      const ok = ingested.length - failed.length;
      if (ok > 0) toast(`${ok} document${ok === 1 ? "" : "s"} classified and ready for review.`);
      if (failed.length > 0) {
        setUploadError(
          `${failed.length} file${failed.length === 1 ? "" : "s"} failed: ${failed
            .map((d) => d.parse_error)
            .filter(Boolean)
            .slice(0, 2)
            .join("; ")}`,
        );
      }
      await loadDocs();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const needsReviewCount = useMemo(
    () => docs.filter((d) => d.ingestion_status === "needs_review").length,
    [docs],
  );

  if (projectLoading) {
    return (
      <AppShell user={user} title="PM Documents">
        <PageSection>
          <div className="flex items-center gap-2 py-2 text-[13px] text-mute">
            <Loader2 className="size-3.5 animate-spin" /> Loading your project…
          </div>
        </PageSection>
      </AppShell>
    );
  }

  if (projectError || !engagementId) {
    return (
      <AppShell user={user} title="PM Documents">
        <PageSection>
          <p className="text-[13px] text-mute">
            {projectError ??
              "You're not staffed on a project yet — an admin needs to add you before there's anything to show here."}
          </p>
        </PageSection>
      </AppShell>
    );
  }

  return (
    <AppShell user={user} title="PM Documents">
      <div className="flex flex-col gap-5">
        <PageSection
          label="Upload"
          subtitle="Charter, deliverables matrix, BRD/PRD, change requests, epic briefs, sprint notes, retros, status reports, risk logs, UAT sign-offs, or meeting notes — individually, as a folder, or as a .zip. SOW uploads happen during project setup."
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".md,.markdown,.txt,.pdf,.docx,.zip"
            className="hidden"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            // @ts-expect-error -- non-standard attribute, but universally supported for folder picking
            webkitdirectory=""
            className="hidden"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
            }}
            className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors duration-150 ${
              dragOver ? "border-brand bg-brand-soft" : "border-border"
            }`}
          >
            {uploading ? (
              <Loader2 className="size-6 animate-spin text-brand" />
            ) : (
              <Upload className="size-6 text-mute" />
            )}
            <p className="text-[13px] text-mute">Drag files or a folder here, or</p>
            <div className="flex items-center gap-2">
              <GhostButton tone="brand" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                Choose files or .zip
              </GhostButton>
              <GhostButton tone="brand" onClick={() => folderInputRef.current?.click()} disabled={uploading}>
                <FolderInput className="size-3.5" /> Choose a folder
              </GhostButton>
            </div>
            {uploadError && <p className="max-w-md text-[12px] font-medium text-danger">{uploadError}</p>}
          </div>
        </PageSection>

        <PageSection label={`Documents${needsReviewCount ? ` — ${needsReviewCount} awaiting review` : ""}`}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Select value={statusFilter || "__all"} onValueChange={(v) => setStatusFilter(v === "__all" ? "" : v)}>
              <SelectTrigger className="h-8 w-40 text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((s) => (
                  <SelectItem key={s.value} value={s.value || "__all"} className="text-[12px]">
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={typeFilter || "__all"} onValueChange={(v) => setTypeFilter(v === "__all" ? "" : v)}>
              <SelectTrigger className="h-8 w-44 text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all" className="text-[12px]">All types</SelectItem>
                {PM_DOC_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="text-[12px]">
                    {DOC_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <GhostButton tone="neutral" onClick={() => loadDocs()} className="ml-auto">
              <RotateCcw className="size-3.5" /> Refresh
            </GhostButton>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-mute">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          ) : docs.length === 0 ? (
            <EmptyState
              icon={<Check />}
              body="No documents match this filter yet. Upload something above to get started."
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {docs.map((doc) => (
                <DocCard key={doc.id} doc={doc} onOpen={() => setSelected(doc)} />
              ))}
            </div>
          )}
        </PageSection>
      </div>

      <DocumentReviewDrawer
        document={selected}
        reviewerName={user.email || user.name}
        onClose={() => setSelected(null)}
        onChanged={(updated, deletedId) => {
          if (deletedId) {
            setDocs((prev) => prev.filter((d) => d.id !== deletedId));
            setSelected(null);
            return;
          }
          if (updated) {
            setDocs((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
            setSelected(updated);
          }
        }}
      />
    </AppShell>
  );
}
