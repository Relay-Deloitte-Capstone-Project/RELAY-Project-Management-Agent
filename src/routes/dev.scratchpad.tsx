import { createFileRoute } from "@tanstack/react-router";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import {
  EmptyState,
  GhostButton,
  PageSection,
  Panel,
} from "@/components/relay/primitives";
import { scratchpadNotes } from "@/lib/mockData";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/dev/scratchpad")({
  head: () => ({
    meta: [
      { title: "Scratchpad — Relay" },
      {
        name: "description",
        content:
          "Private notes and auto-drafted knowledge from your merged pull requests. Approve, edit or dismiss — default is dismiss.",
      },
      { property: "og:title", content: "Scratchpad — Relay" },
      {
        property: "og:description",
        content: "Auto-drafted notes from PRs land here as drafts. Nothing is stored unless you approve.",
      },
    ],
  }),
  component: Scratchpad;
});

function Scratchpad() {
  const drafts = scratchpadNotes.filter((n) => !n.approved);
  const [approved, setApproved] = useState(scratchpadNotes.filter((n) => n.approved));
  const [dismissed, setDismissed] = useState<number[]>([]);

  const visibleDrafts = drafts.filter((d) => !dismissed.includes(d.id));

  return (
    <AppShell role="developer" title="Scratchpad">
      <PageSection
        label="Auto-drafted from your PRs"
        subtitle="Generated when a pull request merges. Default is dismiss — nothing is stored unless you approve."
      >
        {visibleDrafts.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<Pencil />}
              body="No drafts waiting. Merge a pull request and a draft note will appear here."
            />
          </Panel>
        ) : (
          visibleDrafts.map((note) => (
            <div
              key={note.id}
              className="mb-2 rounded-r-lg border-l-[3px] border-l-warning bg-warning-soft px-3.5 py-2.5"
            >
              <h3 className="text-[12px] font-semibold text-ink">{note.title}</h3>
              <p className="mt-1 text-[11px] leading-[1.5] text-mute">{note.body}</p>
              <div className="mt-1.5 text-[10px] text-mute">
                Drafted from {note.source} · {note.draftedAt}
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <GhostButton
                  tone="success"
                  onClick={() => {
                    setApproved((prev) => [
                      { ...note, approved: true, approvedAt: "just now" },
                      ...prev,
                    ]);
                    setDismissed((prev) => [...prev, note.id]);
                  }}
                >
                  Approve
                </GhostButton>
                <GhostButton>Edit</GhostButton>
                <GhostButton onClick={() => setDismissed((prev) => [...prev, note.id])}>
                  Dismiss
                </GhostButton>
              </div>
              <p className="mt-1.5 text-[9px] text-mute italic">
                Approving keeps this note even if project data is later deleted.
              </p>
            </div>
          ))
        )}
      </PageSection>

      <div className="mb-6 h-px bg-border" />

      <PageSection
        label="Approved notes"
        subtitle="These belong to you. If the client data is deleted, notes without client specifics survive."
      >
        {approved.map((note) => (
          <div
            key={note.id}
            className="group mb-2 rounded-r-lg border border-border border-l-[3px] border-l-success bg-card px-3.5 py-2.5"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-[12px] font-semibold text-ink">{note.title}</h3>
              <span className="flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                <GhostButton>
                  <Pencil />
                </GhostButton>
                <GhostButton tone="danger">
                  <Trash2 />
                </GhostButton>
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-[1.5] text-mute">{note.body}</p>
            <div className="mt-1.5 text-[10px] text-mute">
              Approved {note.approvedAt} · From {note.source}
            </div>
          </div>
        ))}

        <div className="mt-4 flex justify-center">
          <Dialog>
            <DialogTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[11px] font-medium text-mute transition-colors duration-150 hover:border-brand hover:text-brand [&_svg]:size-3"
              >
                <Plus /> Write a note
              </button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="text-[14px]">New scratchpad note</DialogTitle>
                <DialogDescription className="text-[12px]">
                  Private to you. Promote it to the team knowledge base when the ticket closes.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <Input placeholder="Note title" className="text-[12px]" />
                <Textarea
                  placeholder="What did you learn? Include the reasoning, not just the fix."
                  rows={5}
                  className="text-[12px]"
                />
              </div>
              <DialogFooter>
                <Button variant="ghost" size="sm">
                  Cancel
                </Button>
                <Button size="sm">Save note</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </PageSection>

      <PageSection label="Retention rule">
        <Panel>
          <p className="text-[12px] leading-relaxed text-mute">
            If a note references specific client data, it is deleted when the client leaves — even
            though it is &quot;personal.&quot; Private controls{" "}
            <span className="font-medium text-ink">who</span> sees it, not{" "}
            <span className="font-medium text-ink">whether</span> it is allowed to exist.
          </p>
        </Panel>
      </PageSection>
    </AppShell>
  );
}
