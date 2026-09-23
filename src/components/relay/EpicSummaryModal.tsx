import { Loader2, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Chip, GhostButton, ProgressRow, SectionLabel } from "@/components/relay/primitives";

// Shared by both dev.epics.tsx and mgr.epics.tsx, whose Epic types differ
// (epic_key/epic_title vs key/title, completion_percent vs completion_pct)
// — each page normalizes its own shape into this one before opening the
// modal, so this component stays dumb/presentation-only.
export type EpicSummaryModalData = {
  epicKey: string;
  title: string;
  status: string;
  ticketCount: number;
  completionPct: number;
  scopeCompliancePct: number | null;
  summary: string | null;
  loading: boolean;
};

export function EpicSummaryModal({
  data,
  onClose,
}: {
  data: EpicSummaryModalData | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={data !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        {data && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2 text-[15px]">
                {data.title}
                <Chip tone="brand">{data.epicKey}</Chip>
              </DialogTitle>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <div>
                <SectionLabel>Status</SectionLabel>
                <p className="text-[13px] font-medium text-ink">{data.status}</p>
              </div>
              <div>
                <SectionLabel>Tickets</SectionLabel>
                <p className="text-[13px] font-medium text-ink">{data.ticketCount}</p>
              </div>
              <ProgressRow label="Completion" value={data.completionPct} inline />
              {data.scopeCompliancePct !== null && (
                <ProgressRow label="Scope alignment" value={data.scopeCompliancePct} inline />
              )}
            </div>

            <div>
              <div className="mb-1.5 flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-brand" />
                <SectionLabel className="mb-0">AI summary</SectionLabel>
              </div>
              {data.loading ? (
                <div className="flex items-center gap-2 text-[13px] text-mute">
                  <Loader2 className="size-3.5 animate-spin" /> Generating…
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">
                  {data.summary}
                </p>
              )}
            </div>

            <DialogFooter>
              <GhostButton onClick={onClose}>Cancel</GhostButton>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
