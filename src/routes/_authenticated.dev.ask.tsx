import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  Loader2,
  MessageSquare,
  PanelLeft,
  PanelLeftClose,
  Plus,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AppShell } from "@/components/relay/AppShell";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dev/ask")({
  head: () => ({
    meta: [
      { title: "Ask the project — Relay" },
      {
        name: "description",
        content:
          "Ask questions about the project and get answers with clickable citations to tickets, commits and PR discussions — or an honest abstention.",
      },
      { property: "og:title", content: "Ask the project — Relay" },
      {
        property: "og:description",
        content: "Cited answers from tickets, commits and PR threads. No invented answers.",
      },
    ],
  }),
  component: AskProject,
});

// The FastAPI backend (backend/main.py) — override with VITE_ASK_API_URL if it's
// running somewhere other than the default local port.
const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

// The corpus this backend serves is all under this engagement — matches the
// backend's own RELAY_ENGAGEMENT_ID default (backend/api/query.py).
const ENGAGEMENT_ID = "proj-001";

type Source = {
  source_doc_id: string;
  source_type: string;
  snippet: string;
};

type QueryResponse = {
  answer: string;
  sources: Source[];
  abstained: boolean;
  provider?: string;
  timing_seconds?: number;
};

type SessionSummary = {
  id: string;
  title: string | null;
  created_at: string;
  message_count: number;
};

type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: Source[];
  abstained: boolean;
  created_at: string;
};

type Message =
  | { role: "user"; text: string }
  | { role: "abstain"; timingSeconds?: number }
  | {
      role: "assistant";
      text: string;
      sources: Source[];
      provider?: string;
      timingSeconds?: number;
    }
  | { role: "error"; text: string };

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

function listSessions(userId: string) {
  return apiCall<SessionSummary[]>(
    `/api/sessions?user_id=${encodeURIComponent(userId)}&engagement_id=${ENGAGEMENT_ID}`,
  );
}

function createSession(userId: string) {
  return apiCall<{ session_id: string; created_at: string }>("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, engagement_id: ENGAGEMENT_ID }),
  });
}

function deleteSession(sessionId: string, userId: string) {
  return apiCall<{ ok: boolean }>(
    `/api/sessions/${sessionId}?user_id=${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  );
}

function getSessionMessages(sessionId: string, userId: string) {
  return apiCall<StoredMessage[]>(
    `/api/sessions/${sessionId}/messages?user_id=${encodeURIComponent(userId)}`,
  );
}

function sendSessionMessage(sessionId: string, userId: string, question: string) {
  return apiCall<QueryResponse>(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId, question }),
  });
}

function storedToMessage(m: StoredMessage): Message {
  if (m.role === "user") return { role: "user", text: m.content };
  if (m.abstained) return { role: "abstain" };
  return { role: "assistant", text: m.content, sources: m.sources };
}

function sessionDate(createdAt: string): string {
  const d = new Date(createdAt);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  return sameDay
    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

// The LLM cites sources inline ([KPD-27], [467d828]) and the UI renders each
// source as a clickable chip — showing both duplicates every citation, so the
// inline markers are stripped from the prose and the chips carry them.
const CITATION_RE = /\[\s*(?:[A-Z]+-\d+|[0-9a-f]{7,40})\s*\]/g;

function stripCitations(text: string): string {
  return text
    .replace(CITATION_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +\n/g, "\n")
    .trim();
}

function chipLabel(s: Source): string {
  // Commits cite as short sha (the full 40-char id is unreadable in a chip).
  return s.source_type === "github_commit" ? s.source_doc_id.slice(0, 7) : s.source_doc_id;
}

function AskProject() {
  const { user } = Route.useRouteContext();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [openCitation, setOpenCitation] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await listSessions(user.id));
    } catch {
      // A failed history refresh leaves the current list as-is.
    }
  }, [user.id]);

  const loadSession = useCallback(
    async (id: string) => {
      setLoadingHistory(true);
      setOpenCitation(null);
      try {
        const history = await getSessionMessages(id, user.id);
        setSessionId(id);
        setMessages(history.map(storedToMessage));
      } catch {
        setMessages([{ role: "error", text: "Couldn't load that conversation." }]);
      } finally {
        setLoadingHistory(false);
      }
    },
    [user.id],
  );

  // Resume the most recent conversation on load instead of always starting
  // blank — a session is only created lazily on the first message sent if
  // none exists yet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listSessions(user.id);
        if (cancelled) return;
        setSessions(list);
        const mostRecent = list[0];
        if (!mostRecent) return;

        const history = await getSessionMessages(mostRecent.id, user.id);
        if (cancelled) return;
        setSessionId(mostRecent.id);
        setMessages(history.map(storedToMessage));
      } catch {
        // No history to resume is not an error state — just start fresh.
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  function handleNewChat() {
    setSessionId(null);
    setMessages([]);
    setOpenCitation(null);
    setLoadingHistory(false);
  }

  async function handleDeleteSession(id: string) {
    setDeletingId(id);
    try {
      await deleteSession(id, user.id);
      setSessions((s) => s.filter((x) => x.id !== id));
      if (sessionId === id) handleNewChat();
    } catch {
      // Leave the list untouched if the delete failed.
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const question = draft.trim();
    if (!question || pending) return;

    setDraft("");
    setMessages((m) => [...m, { role: "user", text: question }]);
    setPending(true);

    const clientStart = performance.now();
    try {
      let sid = sessionId;
      const isNewSession = !sid;
      if (!sid) {
        sid = (await createSession(user.id)).session_id;
        setSessionId(sid);
      }

      const data = await sendSessionMessage(sid, user.id, question);
      const timingSeconds = data.timing_seconds ?? (performance.now() - clientStart) / 1000;

      const reply: Message = data.abstained
        ? { role: "abstain", timingSeconds }
        : {
            role: "assistant",
            text: data.answer,
            sources: data.sources,
            timingSeconds,
            ...(data.provider !== undefined && { provider: data.provider }),
          };
      setMessages((m) => [...m, reply]);

      // The backend auto-titles a session from its first question — refetch so
      // the sidebar shows the real title and the new session appears.
      if (isNewSession) void refreshSessions();
      else
        setSessions((s) =>
          s.map((x) =>
            x.id === sid ? { ...x, title: x.title ?? question.slice(0, 60) } : x,
          ),
        );
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          role: "error",
          text:
            err instanceof Error
              ? `Couldn't reach the backend: ${err.message}`
              : "Couldn't reach the backend.",
        },
      ]);
    } finally {
      setPending(false);
    }
  }

  const sidebarToggle = (
    <button
      type="button"
      onClick={() => setSidebarOpen((o) => !o)}
      title={sidebarOpen ? "Hide chat history" : "Show chat history"}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-card text-mute transition-colors duration-150 hover:border-brand hover:text-ink [&_svg]:size-4"
    >
      {sidebarOpen ? <PanelLeftClose /> : <PanelLeft />}
    </button>
  );

  return (
    <AppShell user={user} title="Ask project" padded={false}>
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && (
          <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
            <div className="flex items-center gap-2 p-3">
              <button
                type="button"
                onClick={handleNewChat}
                className="inline-flex h-8 flex-grow items-center justify-center gap-1.5 rounded-md border border-border bg-card text-[13px] font-medium text-ink transition-colors duration-150 hover:border-brand [&_svg]:size-3.5"
              >
                <Plus /> New chat
              </button>
              {sidebarToggle}
            </div>

            <p className="section-label px-3 pb-2">Chat history</p>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {sessions.length === 0 ? (
                <p className="px-1 py-2 text-[12px] leading-relaxed text-mute">
                  No past conversations yet — ask something and it&apos;ll show up here.
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {sessions.map((s) => (
                    <li key={s.id}>
                      <div
                        className={cn(
                          "group flex w-full items-center gap-1 rounded-md px-2.5 py-2 text-left transition-colors duration-150",
                          s.id === sessionId
                            ? "bg-brand-soft"
                            : "hover:bg-surface-sunken",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => void loadSession(s.id)}
                          className="min-w-0 flex-grow text-left"
                        >
                          <span
                            className={cn(
                              "flex items-center gap-1.5 truncate text-[13px]",
                              s.id === sessionId ? "font-medium text-brand" : "text-ink",
                            )}
                          >
                            <MessageSquare className="size-3 shrink-0 text-mute" />
                            <span className="truncate">
                              {s.title ?? "Untitled conversation"}
                            </span>
                          </span>
                          <span className="mt-0.5 block pl-[18px] text-[11px] text-mute">
                            {sessionDate(s.created_at)} · {s.message_count} message
                            {s.message_count === 1 ? "" : "s"}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteSession(s.id)}
                          disabled={deletingId === s.id}
                          title="Delete conversation"
                          className="shrink-0 rounded p-1 text-mute opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:text-danger disabled:opacity-40 [&_svg]:size-3.5"
                        >
                          {deletingId === s.id ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <Trash2 />
                          )}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-6">
            <div className="flex items-center gap-2">
              {!sidebarOpen && sidebarToggle}
              <p className="section-label">Conversation · grounded in this project&apos;s records</p>
            </div>

            {loadingHistory ? (
              <div className="flex max-w-[80%] items-center gap-2 rounded-lg border border-border bg-surface-sunken px-3.5 py-2.5 text-[13px] text-mute">
                <Loader2 className="size-3.5 animate-spin" /> Loading conversation…
              </div>
            ) : (
              messages.length === 0 && (
                <div className="max-w-[80%] rounded-lg border border-border bg-surface-sunken px-3.5 py-2.5 text-[13px] leading-relaxed text-mute">
                  Ask a question below — it&apos;s embedded, matched against indexed tickets and
                  commits, and answered only from what&apos;s found.
                </div>
              )
            )}

            {!loadingHistory &&
              messages.map((msg, i) => {
                if (msg.role === "user") {
                  return (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[75%] rounded-xl rounded-br-sm bg-brand px-3.5 py-2.5 text-[13px] leading-relaxed text-brand-foreground">
                        {msg.text}
                      </div>
                    </div>
                  );
                }

                if (msg.role === "abstain") {
                  return (
                    <div key={i} className="max-w-[80%]">
                      <div className="rounded-lg border border-border bg-surface-sunken px-3.5 py-2.5 text-[13px] text-mute italic">
                        I don&apos;t have grounding for that in this project&apos;s records.
                      </div>
                      <div className="mt-1 text-[11px] text-mute">
                        Abstained · 0 sources
                        {msg.timingSeconds !== undefined && ` · ${msg.timingSeconds.toFixed(2)}s`}
                      </div>
                    </div>
                  );
                }

                if (msg.role === "error") {
                  return (
                    <div key={i} className="max-w-[80%]">
                      <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-[13px] text-destructive">
                        {msg.text}
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={i} className="max-w-[80%]">
                    <div className="rounded-xl rounded-bl-sm border border-border bg-card px-3.5 py-2.5 text-[13px] leading-relaxed text-ink whitespace-pre-line">
                      {stripCitations(msg.text)}{" "}
                      {msg.sources.map((s) => (
                        <button
                          key={s.source_doc_id}
                          type="button"
                          onClick={() =>
                            setOpenCitation(openCitation === s.source_doc_id ? null : s.source_doc_id)
                          }
                          className="mx-0.5 rounded-[3px] bg-brand-soft px-[5px] py-[1px] font-mono text-[11px] font-semibold text-brand"
                        >
                          [{chipLabel(s)}]
                        </button>
                      ))}
                    </div>
                    {msg.sources
                      .filter((s) => s.source_doc_id === openCitation)
                      .map((s) => (
                        <div
                          key={s.source_doc_id}
                          className="mt-2 border-l-[3px] border-brand bg-surface-sunken p-2 text-[13px] leading-relaxed text-mute"
                        >
                          <span className="font-mono font-semibold text-brand">{s.source_doc_id}</span>{" "}
                          ({s.source_type}) — {s.snippet}
                        </div>
                      ))}
                    <div className="mt-1 text-[11px] text-mute">
                      {msg.provider ?? "llm"} · {msg.sources.length} source
                      {msg.sources.length === 1 ? "" : "s"}
                      {msg.timingSeconds !== undefined && ` · ${msg.timingSeconds.toFixed(2)}s`}
                    </div>
                  </div>
                );
              })}

            {pending && (
              <div className="flex max-w-[80%] items-center gap-2 rounded-xl rounded-bl-sm border border-border bg-card px-3.5 py-2.5 text-[13px] text-mute">
                <Loader2 className="size-3.5 animate-spin" /> Searching project records…
              </div>
            )}

            <div className="mt-2 max-w-[80%] rounded-lg border border-border bg-surface-sunken p-3 text-[13px] leading-relaxed text-mute">
              Permission is checked <span className="font-medium text-ink">before</span> retrieval,
              and each retrieved chunk&apos;s provenance is re-checked against live permissions.
              Response time is normalised, so a denial and a genuine &quot;nothing found&quot; are
              indistinguishable.
            </div>
          </div>

          <form
            onSubmit={handleSubmit}
            className="flex h-14 shrink-0 items-center gap-3 border-t border-border px-6"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask anything about this project..."
              disabled={pending}
              className="h-9 flex-grow rounded-md border border-border bg-card px-3 text-[13px] text-ink outline-none transition-colors duration-150 placeholder:text-mute focus:border-brand disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={pending || !draft.trim()}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand px-3.5 text-[13px] font-medium text-brand-foreground transition-transform duration-100 active:scale-[0.98] disabled:opacity-50 [&_svg]:size-3.5"
            >
              Send <ArrowRight />
            </button>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
