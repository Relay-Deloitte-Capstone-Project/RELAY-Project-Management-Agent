import { createFileRoute } from "@tanstack/react-router";
import { FileText, GitPullRequest, History, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/relay/AppShell";
import { EmptyState, GhostButton, PageSection, Panel } from "@/components/relay/primitives";
import { useMyProject } from "@/lib/admin/useMyProject";
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

// How often the page re-checks for new drafts / the last sync timestamp.
// backend/main.py's own eval loop runs on its own multi-minute schedule
// (SCRATCHPAD_EVAL_INTERVAL_MINUTES) — this just makes an already-updated
// server visible to an open tab without a manual refresh.
const POLL_INTERVAL_MS = 20_000;

type NoteStatus = "draft" | "approved" | "promoted";

type ScratchpadNote = {
  id: string;
  title: string | null;
  content: string;
  status: NoteStatus;
  source_pr: string | null;
  pr_head_sha: string | null;
  // Which Jira ticket this was auto-drafted from — survives approval (it's
  // just where the note came from, not a live pointer). provenance_count
  // is how many commit chunks it was distilled from; approve_note() zeroes
  // this out on approval (the actual "provenance cut" — see
  // backend/api/scratchpad.py), so a 0 here on an approved note is by
  // design, not a bug.
  source_ticket: string | null;
  provenance_count: number;
  current_version: number;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
};

type NoteSources = {
  source_ticket: string | null;
  engagement_id: string;
  commits: { sha_short: string | null; url: string | null; message: string | null }[];
};

// One row per source in public.sync_state — backend/api/sync.py's real
// GET /api/sync/status, shared with the rest of the app (not a Scratchpad-
// only endpoint). "scratchpad_eval" is written by backend/main.py's
// _scratchpad_eval_loop alongside jira/github_commits/github_prs.
type SyncStatusRow = {
  source: string;
  last_synced_at: string | null;
  last_status: string | null;
  last_count: number | null;
};

type NoteVersion = {
  id: string;
  version_num: number;
  title: string | null;
  content: string;
  change_reason: "manual_edit" | "pr_update";
  pr_diff_ref: string | null;
  created_at: string;
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

// Identity here is email, not the Prisma user id — matching api/access.py
// and api/me.py, which key off email against public.project_staffing
// because the Python backend has no query access to Prisma's own database
// (separate SQLite instance). Auto-drafted notes are created backend-side
// the same way, resolving a Jira ticket's assignee to an email via that
// same table — so a developer's own notes and their auto-drafts land under
// the same identity value.
function listNotes(email: string, engagementId: string) {
  return apiCall<ScratchpadNote[]>(
    `/api/scratchpad?email=${encodeURIComponent(email)}&engagement_id=${encodeURIComponent(engagementId)}`,
  );
}

function createNote(
  email: string,
  engagementId: string,
  title: string,
  content: string,
  sourcePr?: string,
) {
  return apiCall<ScratchpadNote>("/api/scratchpad", {
    method: "POST",
    body: JSON.stringify({
      email,
      engagement_id: engagementId,
      title,
      content,
      source_pr: sourcePr ?? null,
    }),
  });
}

function approveNote(email: string, id: string) {
  return apiCall<{ ok: true }>(
    `/api/scratchpad/${id}/approve?email=${encodeURIComponent(email)}`,
    { method: "PATCH" },
  );
}

function promoteNote(email: string, id: string) {
  return apiCall<{ ok: true }>(
    `/api/scratchpad/${id}/promote?email=${encodeURIComponent(email)}`,
    { method: "PATCH" },
  );
}

function deleteNote(email: string, id: string) {
  return apiCall<{ ok: true }>(`/api/scratchpad/${id}?email=${encodeURIComponent(email)}`, {
    method: "DELETE",
  });
}

function updateNote(email: string, id: string, title: string, content: string) {
  return apiCall<ScratchpadNote>(`/api/scratchpad/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ email, title, content }),
  });
}

function listVersions(email: string, id: string) {
  return apiCall<NoteVersion[]>(
    `/api/scratchpad/${id}/versions?email=${encodeURIComponent(email)}`,
  );
}

function checkPrUpdate(email: string, id: string) {
  return apiCall<{ changed: boolean; pr_head_sha: string; diffstat?: string }>(
    `/api/scratchpad/${id}/check-pr-update?email=${encodeURIComponent(email)}`,
    { method: "POST" },
  );
}

function noteSources(email: string, id: string) {
  return apiCall<NoteSources>(`/api/scratchpad/${id}/sources?email=${encodeURIComponent(email)}`);
}

function fetchSyncStatus() {
  return apiCall<SyncStatusRow[]>("/api/sync/status");
}

// "3m ago" style label for the sync indicator — coarse on purpose, this is
// a small ambient signal, not a countdown.
function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
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
  const { project, loading: projectLoading, error: projectError } = useMyProject(user.email);
  const engagementId = project?.engagement_id ?? null;

  const [notes, setNotes] = useState<ScratchpadNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [editingNote, setEditingNote] = useState<ScratchpadNote | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [historyNoteId, setHistoryNoteId] = useState<string | null>(null);
  const [versions, setVersions] = useState<NoteVersion[] | null>(null);
  const [versionsError, setVersionsError] = useState<string | null>(null);

  const [sourcesOpenId, setSourcesOpenId] = useState<string | null>(null);
  const [sourcesById, setSourcesById] = useState<Record<string, NoteSources>>({});

  const [syncStatus, setSyncStatus] = useState<SyncStatusRow[] | null>(null);

  async function toggleSources(id: string) {
    if (sourcesOpenId === id) {
      setSourcesOpenId(null);
      return;
    }
    setSourcesOpenId(id);
    if (!sourcesById[id]) {
      try {
        const result = await noteSources(user.email, id);
        setSourcesById((prev) => ({ ...prev, [id]: result }));
      } catch {
        // Best-effort — the ticket badge already shown is the important
        // part; a failed detail fetch just leaves the list empty.
      }
    }
  }

  const drafts = notes.filter((n) => n.status === "draft");
  const approved = notes.filter((n) => n.status !== "draft");

  // Polls rather than loading once — a bug ticket closing or a fix landing
  // enough commits to qualify (backend/api/scratchpad_triggers.py) creates a
  // draft server-side on its own schedule; this is what makes that show up
  // in an already-open tab without a manual refresh. Only the very first
  // load shows the spinner — a background refresh swapping in new rows
  // shouldn't flash the whole panel.
  useEffect(() => {
    if (!engagementId) return;
    let cancelled = false;

    async function load(isInitial: boolean) {
      if (isInitial) setLoading(true);
      try {
        const result = await listNotes(user.email, engagementId as string);
        if (!cancelled) {
          setNotes(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Couldn't load notes.");
        }
      } finally {
        if (isInitial && !cancelled) setLoading(false);
      }
    }

    load(true);
    const interval = setInterval(() => load(false), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user.email, engagementId]);

  // Independent of engagementId/notes — this is just the small ambient
  // "Synced Xm ago" indicator, backed by backend/main.py's /api/sync/status.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await fetchSyncStatus();
        if (!cancelled) setSyncStatus(result);
      } catch {
        // Best-effort — a failed status check shouldn't disrupt the page.
      }
    }
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function handleSaveNote() {
    const title = draftTitle.trim();
    const body = draftBody.trim();
    if (!title || !body || saving || !engagementId) return;

    setSaving(true);
    setSaveError(null);
    try {
      const note = await createNote(user.email, engagementId, title, body);
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
      await approveNote(user.email, id);
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
      await promoteNote(user.email, id);
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
      await deleteNote(user.email, id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete note.");
    } finally {
      setBusyId(null);
    }
  }

  function openEdit(note: ScratchpadNote) {
    setEditingNote(note);
    setEditTitle(note.title ?? "");
    setEditBody(note.content);
    setEditError(null);
  }

  async function handleSaveEdit() {
    if (!editingNote || editSaving) return;
    const title = editTitle.trim();
    const content = editBody.trim();
    if (!content) return;

    setEditSaving(true);
    setEditError(null);
    try {
      const updated = await updateNote(user.email, editingNote.id, title, content);
      setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
      setEditingNote(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Couldn't save changes.");
    } finally {
      setEditSaving(false);
    }
  }

  async function openHistory(id: string) {
    setHistoryNoteId(id);
    setVersions(null);
    setVersionsError(null);
    try {
      const result = await listVersions(user.email, id);
      setVersions(result);
    } catch (err) {
      setVersionsError(err instanceof Error ? err.message : "Couldn't load version history.");
    }
  }

  async function handleCheckPrUpdate(id: string) {
    if (busyId) return;
    setBusyId(id);
    try {
      const result = await checkPrUpdate(user.email, id);
      if (result.changed) {
        toast(`Linked PR has new changes (${result.diffstat}) — a version was saved.`);
        const updated = notes.find((n) => n.id === id);
        if (updated) {
          setNotes((prev) =>
            prev.map((n) =>
              n.id === id
                ? { ...n, pr_head_sha: result.pr_head_sha, current_version: n.current_version + 1 }
                : n,
            ),
          );
        }
      } else {
        toast("No code changes since this note was last synced.");
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't check the linked PR.");
    } finally {
      setBusyId(null);
    }
  }

  // "scratchpad_eval" is the pass that actually decides whether a closed
  // ticket becomes a draft — most relevant to this page. Fall back to the
  // plain Jira poll if that source hasn't recorded a pass yet (e.g. right
  // after a cold start, before its first 30s delay elapses).
  const scratchpadSync = syncStatus?.find((r) => r.source === "scratchpad_eval");
  const jiraSync = syncStatus?.find((r) => r.source === "jira");
  const syncIndicator = (
    <span
      className="text-[11px] text-mute"
      title="Last time Relay checked Jira/GitHub for new knowledge-worthy fixes"
    >
      Synced {relativeTime(scratchpadSync?.last_synced_at ?? jiraSync?.last_synced_at ?? null)}
    </span>
  );

  if (projectLoading) {
    return (
      <AppShell user={user} title="Scratchpad" headerExtra={syncIndicator}>
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
      <AppShell user={user} title="Scratchpad" headerExtra={syncIndicator}>
        <PageSection>
          <Panel>
            <p className="text-[13px] text-mute">
              {projectError ??
                "You're not staffed on a project yet — an admin needs to add you before Scratchpad has anything to show."}
            </p>
          </Panel>
        </PageSection>
      </AppShell>
    );
  }

  return (
    <AppShell user={user} title="Scratchpad" headerExtra={syncIndicator}>
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
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-mute">
                {note.source_ticket ? (
                  <span className="rounded-sm bg-brand-soft px-1.5 py-0.5 font-medium text-brand">
                    <FileText className="inline size-3 -translate-y-px" /> {note.source_ticket}
                  </span>
                ) : (
                  <span>Drafted from {note.source_pr ?? "manual"}</span>
                )}
                <span>
                  · {new Date(note.created_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                  {note.current_version > 1 && ` · v${note.current_version}`}
                </span>
              </div>
              {note.provenance_count > 0 && (
                <div className="mt-1">
                  <button
                    type="button"
                    className="text-[11px] font-medium text-brand hover:underline"
                    onClick={() => toggleSources(note.id)}
                  >
                    {sourcesOpenId === note.id ? "Hide" : "Show"} {note.provenance_count} source
                    commit{note.provenance_count === 1 ? "" : "s"}
                  </button>
                  {sourcesOpenId === note.id && sourcesById[note.id] && (
                    <ul className="mt-1 space-y-0.5 border-l-2 border-border pl-2">
                      {(sourcesById[note.id] as NoteSources).commits.map((c, i) => (
                        <li key={c.sha_short ?? i} className="text-[11px] text-mute">
                          <code className="text-brand">{c.sha_short ?? "?"}</code>{" "}
                          {c.message ?? ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <div className="mt-2.5 flex items-center gap-2">
                <GhostButton
                  tone="success"
                  disabled={busyId === note.id}
                  onClick={() => handleApprove(note.id)}
                >
                  {busyId === note.id ? "Approving…" : "Approve"}
                </GhostButton>
                <GhostButton onClick={() => openEdit(note)}>Edit</GhostButton>
                {note.source_pr && (
                  <GhostButton
                    disabled={busyId === note.id}
                    onClick={() => handleCheckPrUpdate(note.id)}
                  >
                    <GitPullRequest /> Check PR
                  </GhostButton>
                )}
                {note.current_version > 1 && (
                  <GhostButton onClick={() => openHistory(note.id)}>
                    <History /> History
                  </GhostButton>
                )}
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
                  {note.source_pr && (
                    <span title="Check for code changes on the linked PR">
                      <GhostButton
                        disabled={busyId === note.id}
                        onClick={() => handleCheckPrUpdate(note.id)}
                      >
                        <GitPullRequest />
                      </GhostButton>
                    </span>
                  )}
                  {note.current_version > 1 && (
                    <span title="Version history">
                      <GhostButton onClick={() => openHistory(note.id)}>
                        <History />
                      </GhostButton>
                    </span>
                  )}
                  <GhostButton onClick={() => openEdit(note)}>
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
                · Originally from{" "}
                {note.source_ticket ?? note.source_pr ?? "a manual note"}
                {note.current_version > 1 && ` · v${note.current_version}`}
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

      <Dialog open={editingNote !== null} onOpenChange={(open) => !open && setEditingNote(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-[14px]">Edit note</DialogTitle>
            <DialogDescription className="text-[13px]">
              Your previous version is kept in this note's history — nothing is lost.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Note title"
              className="text-[13px]"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
            />
            <Textarea
              rows={5}
              className="text-[13px]"
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
            />
            {editError && <p className="text-[12px] text-destructive">{editError}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setEditingNote(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={editSaving || !editBody.trim()} onClick={handleSaveEdit}>
              {editSaving ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={historyNoteId !== null}
        onOpenChange={(open) => !open && setHistoryNoteId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-[14px]">Version history</DialogTitle>
            <DialogDescription className="text-[13px]">
              Every prior version of this note, oldest changes at the bottom.
            </DialogDescription>
          </DialogHeader>
          {versionsError && <p className="text-[13px] text-destructive">{versionsError}</p>}
          {!versions && !versionsError && (
            <div className="flex items-center gap-2 py-2 text-[13px] text-mute">
              <Loader2 className="size-3.5 animate-spin" /> Loading…
            </div>
          )}
          {versions && versions.length === 0 && (
            <p className="text-[13px] text-mute">No prior versions yet.</p>
          )}
          {versions && versions.length > 0 && (
            <div className="max-h-[360px] space-y-2 overflow-y-auto">
              {versions.map((v) => (
                <div key={v.id} className="rounded-lg border border-border px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-semibold text-ink">v{v.version_num}</span>
                    <span className="text-[11px] text-mute">
                      {v.change_reason === "pr_update" ? "code changed" : "manual edit"} ·{" "}
                      {new Date(v.created_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] leading-[1.4] text-mute">{v.content}</p>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

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
