import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import { EmptyState, GhostButton, PageSection, Panel } from "@/components/relay/primitives";
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

// Same FastAPI backend the Ask Project page talks to (backend/main.py).
const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

// The corpus this backend serves is all under this engagement — matches the
// backend's own RELAY_ENGAGEMENT_ID default (backend/api/query.py).
const ENGAGEMENT_ID = "proj-001";

type NoteStatus = "draft" | "approved" | "promoted";

type ScratchpadNote = {
  id: string;
  title: string | null;
  content: string;
  status: NoteStatus;
  source_pr: string | null;
  created_at: string;
  approved_at: string | null;
};

async function apiCall<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Request failed (${res.status})`);
  }
  return res.json();
}

function listNotes(userId: string) {
  return apiCall<ScratchpadNote[]>(
    `/api/scratchpad?user_id=${encodeURIComponent(userId)}&engagement_id=${ENGAGEMENT_ID}`,
  );
}

function createNote(userId: string, title: string, content: string, sourcePr?: string) {
  return apiCall<ScratchpadNote>("/api/scratchpad", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      engagement_id: ENGAGEMENT_ID,
      title,
      content,
      source_pr: sourcePr ?? null,
    }),
  });
}

function approveNote(userId: string, id: string) {
  return apiCall<{ ok: true }>(
    `/api/scratchpad/${id}/approve?user_id=${encodeURIComponent(userId)}`,
    { method: "PATCH" },
  );
}

function promoteNote(userId: string, id: string) {
  return apiCall<{ ok: true }>(
    `/api/scratchpad/${id}/promote?user_id=${encodeURIComponent(userId)}`,
    { method: "PATCH" },
  );
}

function deleteNote(userId: string, id: string) {
  return apiCall<{ ok: true }>(`/api/scratchpad/${id}?user_id=${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}

export const Route = createFileRoute("/_authenticated/dev/scratchpad")({
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
        content:
          "Auto-drafted notes from PRs land here as drafts. Nothing is stored unless you approve.",
      },
    ],
  }),
  component: Scratchpad,
});

function Scratchpad() {
  const { user } = Route.useRouteContext();

  const [notes, setNotes] = useState<ScratchpadNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const drafts = notes.filter((n) => n.status === "draft");
  const approved = notes.filter((n) => n.status !== "draft");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await listNotes(user.id);
        if (!cancelled) setNotes(result);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Couldn't load notes.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  async function handleSaveNote() {
    const title = draftTitle.trim();
    const body = draftBody.trim();
    if (!title || !body || saving) return;

    setSaving(true);
    setSaveError(null);
    try {
      const note = await createNote(user.id, title, body);
      setNotes((prev) => [note, ...prev]);
      setDraftTitle("");
      setDraftBody("");
      setDialogOpen(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save note.");
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove(id: string) {
    if (busyId) return;
    setBusyId(id);
    try {
      await approveNote(user.id, id);
      setNotes((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, status: "approved", approved_at: new Date().toISOString() } : n,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't approve note.");
    } finally {
      setBusyId(null);
    }
  }

  async function handlePromote(id: string) {
    if (busyId) return;
    setBusyId(id);
    try {
      await promoteNote(user.id, id);
      setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, status: "promoted" } : n)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't promote note.");
    } finally {
      setBusyId(null);
    }
  }

  // Dismiss and Delete are the same action server-side — a draft note has
  // nothing else to revert to, so dismissing it is a hard delete.
  async function handleDelete(id: string) {
    if (busyId) return;
    setBusyId(id);
    try {
      await deleteNote(user.id, id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete note.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AppShell user={user} title="Scratchpad">
      <PageSection
        label="Auto-drafted from your PRs"
        subtitle="Generated when a pull request merges. Default is dismiss — nothing is stored unless you approve."
      >
        {loading ? (
          <Panel>
            <div className="flex items-center gap-2 py-2 text-[13px] text-mute">
              <Loader2 className="size-3.5 animate-spin" /> Loading…
            </div>
          </Panel>
        ) : drafts.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<Pencil />}
              body="No drafts waiting. Merge a pull request and a draft note will appear here."
            />
          </Panel>
        ) : (
          drafts.map((note) => (
            <div
              key={note.id}
              className="mb-2 rounded-r-lg border-l-[3px] border-l-warning bg-warning-soft px-3.5 py-2.5"
            >
              <h3 className="text-[13px] font-semibold text-ink">{note.title ?? "Untitled"}</h3>
              <p className="mt-1 text-[13px] leading-[1.5] text-mute">{note.content}</p>
              <div className="mt-1.5 text-[11px] text-mute">
                Drafted from {note.source_pr ?? "manual"} ·{" "}
                {new Date(note.created_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <GhostButton
                  tone="success"
                  disabled={busyId === note.id}
                  onClick={() => handleApprove(note.id)}
                >
                  {busyId === note.id ? "Approving…" : "Approve"}
                </GhostButton>
                <GhostButton>Edit</GhostButton>
                <GhostButton disabled={busyId === note.id} onClick={() => handleDelete(note.id)}>
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
        {error && (
          <div className="mb-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-[13px] text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <Panel>
            <div className="flex items-center gap-2 py-2 text-[13px] text-mute">
              <Loader2 className="size-3.5 animate-spin" /> Loading notes…
            </div>
          </Panel>
        ) : approved.length === 0 && !error ? (
          <Panel>
            <EmptyState icon={<Pencil />} body="No notes yet. Write one below." />
          </Panel>
        ) : (
          approved.map((note) => (
            <div
              key={note.id}
              className="group mb-2 rounded-r-lg border border-border border-l-[3px] border-l-success bg-card px-3.5 py-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-[13px] font-semibold text-ink">{note.title ?? "Untitled"}</h3>
                <span className="flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                  {note.status === "approved" && (
                    <GhostButton
                      tone="brand"
                      disabled={busyId === note.id}
                      onClick={() => handlePromote(note.id)}
                    >
                      Promote
                    </GhostButton>
                  )}
                  <GhostButton>
                    <Pencil />
                  </GhostButton>
                  <GhostButton
                    tone="danger"
                    disabled={busyId === note.id}
                    onClick={() => handleDelete(note.id)}
                  >
                    {busyId === note.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  </GhostButton>
                </span>
              </div>
              <p className="mt-1 text-[13px] leading-[1.5] text-mute">{note.content}</p>
              <div className="mt-1.5 text-[11px] text-mute">
                {note.status === "promoted" ? "Promoted to team knowledge" : "Approved"}{" "}
                {(note.approved_at ?? note.created_at) &&
                  new Date(note.approved_at ?? note.created_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}{" "}
                · From {note.source_pr ?? "manual"}
              </div>
            </div>
          ))
        )}

        <div className="mt-4 flex justify-center">
          <Dialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) {
                setDraftTitle("");
                setDraftBody("");
                setSaveError(null);
              }
            }}
          >
            <DialogTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] font-medium text-mute transition-colors duration-150 hover:border-brand hover:text-brand [&_svg]:size-3"
              >
                <Plus /> Write a note
              </button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="text-[14px]">New scratchpad note</DialogTitle>
                <DialogDescription className="text-[13px]">
                  Private to you. Promote it to the team knowledge base when the ticket closes.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <Input
                  placeholder="Note title"
                  className="text-[13px]"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                />
                <Textarea
                  placeholder="What did you learn? Include the reasoning, not just the fix."
                  rows={5}
                  className="text-[13px]"
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                />
                {saveError && <p className="text-[12px] text-destructive">{saveError}</p>}
              </div>
              <DialogFooter>
                <Button variant="ghost" size="sm" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={saving || !draftTitle.trim() || !draftBody.trim()}
                  onClick={handleSaveNote}
                >
                  {saving ? "Saving…" : "Save note"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </PageSection>

      <PageSection label="Retention rule">
        <Panel>
          <p className="text-[13px] leading-relaxed text-mute">
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
