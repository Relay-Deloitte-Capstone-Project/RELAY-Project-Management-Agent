import { AlertTriangle, Check, ChevronDown, ChevronRight, Loader2, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Chip, GhostButton, SectionLabel } from "@/components/relay/primitives";
import { cn } from "@/lib/utils";
import {
  DOC_TYPE_LABEL,
  PM_DOC_TYPES,
  confirmDocument,
  deleteDocument,
  rejectDocument,
  type PmDocument,
} from "@/lib/admin/pmDocuments";

const ENTITY_LABEL: Record<string, string> = {
  people: "People",
  deliverable_ids: "Deliverables",
  requirement_ids: "Requirements",
  risk_ids: "Risks / Issues",
  ticket_refs: "Tickets",
  decision_ids: "Decisions",
  cr_refs: "Change Requests",
};

function ConfidenceBadge({ value }: { value: number | null }) {
  if (value === null) return null;
  const pct = Math.round(value * 100);
  const tone = value >= 0.85 ? "success" : value >= 0.6 ? "warning" : "danger";
  return (
    <Chip tone={tone}>
      {tone === "success" ? null : <AlertTriangle className="size-3" />}
      {pct}% confidence
    </Chip>
  );
}

function SectionPreview({
  section,
  editable,
  onChange,
}: {
  section: { section_path: string | null; content: string };
  editable: boolean;
  onChange: (next: { section_path: string | null; content: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] font-medium text-ink hover:bg-surface-sunken"
      >
        {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
        <span className="truncate">{section.section_path || "(untitled section)"}</span>
        <span className="ml-auto shrink-0 text-[11px] font-normal text-mute">
          {section.content.length} chars
        </span>
      </button>
      {open && (
        <div className="border-t border-border bg-surface-sunken p-2">
          {editable && (
            <Input
              value={section.section_path ?? ""}
              onChange={(e) => onChange({ ...section, section_path: e.target.value })}
              placeholder="Section path — e.g. Retro > What Went Poorly"
              className="mb-2 h-7 text-[11.5px]"
            />
          )}
          {editable ? (
            <textarea
              value={section.content}
              onChange={(e) => onChange({ ...section, content: e.target.value })}
              rows={8}
              className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[11.5px] text-ink outline-none focus:border-brand"
            />
          ) : (
            <pre className="max-h-64 overflow-auto px-1 py-1 text-[11.5px] whitespace-pre-wrap text-mute">
              {section.content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function DocumentReviewDrawer({
  document,
  reviewerName,
  onClose,
  onChanged,
}: {
  document: PmDocument | null;
  reviewerName: string;
  onClose: () => void;
  onChanged: (updated: PmDocument | null, deletedId?: string) => void;
}) {
  const [docType, setDocType] = useState<string>("");
  const [docId, setDocId] = useState("");
  const [scenario, setScenario] = useState("");
  const [author, setAuthor] = useState("");
  const [sections, setSections] = useState<{ section_path: string | null; content: string }[]>([]);
  const [busy, setBusy] = useState<"confirm" | "reject" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (document) {
      setDocType(document.doc_type);
      setDocId(document.doc_id ?? "");
      setScenario(document.scenario ?? "");
      setAuthor(document.author ?? "");
      setSections(document.pending_sections);
      setError(null);
    }
  }, [document]);

  if (!document) return null;
  const d = document;
  const editable = d.ingestion_status !== "confirmed";

  async function handleConfirm() {
    setBusy("confirm");
    setError(null);
    try {
      const updated = await confirmDocument(d.id, {
        doc_type: docType,
        doc_id: docId || undefined,
        scenario: scenario || undefined,
        pending_sections: sections,
        author: author || undefined,
        confirmed_by: reviewerName,
      });
      toast(`${DOC_TYPE_LABEL[updated.doc_type]} confirmed and indexed.`);
      onChanged(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirm failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleReject() {
    setBusy("reject");
    try {
      await rejectDocument(d.id);
      toast("Document rejected — it stays on file but won't be indexed.");
      onChanged({ ...d, ingestion_status: "rejected" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reject failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    setBusy("delete");
    try {
      await deleteDocument(d.id);
      toast("Document deleted.");
      onChanged(null, d.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setBusy(null);
    }
  }

  const entityEntries = Object.entries(d.entities || {}).filter(([, v]) => (v as string[])?.length);

  return (
    <Sheet open={document !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <SheetTitle className="text-[15px]">{d.source_file_name}</SheetTitle>
            <ConfidenceBadge value={d.classification_confidence} />
          </div>
          <SheetDescription className="text-[12px]">
            {d.classification_notes || "Classified via front matter — no LLM call needed."}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex flex-col gap-4">
          {d.parse_error && (
            <div className="rounded-md bg-danger-soft px-3 py-2 text-[12px] text-danger">
              {d.parse_error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <SectionLabel>Document type</SectionLabel>
              <Select value={docType} onValueChange={setDocType} disabled={d.ingestion_status === "confirmed"}>
                <SelectTrigger className="h-8 text-[12.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PM_DOC_TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="text-[12.5px]">
                      {DOC_TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <SectionLabel>Doc ID</SectionLabel>
              <Input
                value={docId}
                onChange={(e) => setDocId(e.target.value)}
                placeholder="e.g. CR-002"
                className="h-8 text-[12.5px]"
                disabled={d.ingestion_status === "confirmed"}
              />
            </div>
            <div>
              <SectionLabel>Scenario</SectionLabel>
              <Select value={scenario} onValueChange={setScenario} disabled={d.ingestion_status === "confirmed"}>
                <SelectTrigger className="h-8 text-[12.5px]">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="client" className="text-[12.5px]">Client</SelectItem>
                  <SelectItem value="internal" className="text-[12.5px]">Internal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <SectionLabel>Author</SectionLabel>
              <Input
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="—"
                className="h-8 text-[12.5px]"
                disabled={d.ingestion_status === "confirmed"}
              />
            </div>
          </div>

          {entityEntries.length > 0 && (
            <div>
              <SectionLabel>Extracted entities</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                {entityEntries.map(([key, values]) =>
                  (values as string[]).map((v) => (
                    <Chip key={`${key}-${v}`} tone="brand" round>
                      {v}
                    </Chip>
                  )),
                )}
              </div>
            </div>
          )}

          <div>
            <SectionLabel>
              {sections.length} section{sections.length === 1 ? "" : "s"}
              {d.ingestion_status === "confirmed" ? " (indexed)" : " — will become this many chunks. Click one to edit its text before confirming."}
            </SectionLabel>
            <div className="flex flex-col gap-1.5">
              {sections.map((s, i) => (
                <SectionPreview
                  key={i}
                  section={s}
                  editable={editable}
                  onChange={(next) => setSections((prev) => prev.map((p, j) => (j === i ? next : p)))}
                />
              ))}
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-1.5 rounded-md bg-danger-soft px-3 py-2 text-[12px] font-medium text-danger">
              <X className="size-3.5 shrink-0" /> {error}
            </div>
          )}

          <div className="flex items-center gap-2 border-t border-border pt-4">
            {d.ingestion_status !== "confirmed" && d.ingestion_status !== "rejected" && (
              <>
                <GhostButton
                  tone="success"
                  onClick={handleConfirm}
                  disabled={busy !== null || docType === "unclassified"}
                >
                  {busy === "confirm" ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                  Confirm & index
                </GhostButton>
                <GhostButton tone="neutral" onClick={handleReject} disabled={busy !== null}>
                  {busy === "reject" ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Reject
                </GhostButton>
              </>
            )}
            <GhostButton tone="danger" onClick={handleDelete} disabled={busy !== null} className="ml-auto">
              {busy === "delete" ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              Delete
            </GhostButton>
          </div>
          {docType === "unclassified" && d.ingestion_status !== "confirmed" && (
            <p className={cn("text-[11.5px] text-mute")}>
              Set a real document type above before this can be confirmed and indexed.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
