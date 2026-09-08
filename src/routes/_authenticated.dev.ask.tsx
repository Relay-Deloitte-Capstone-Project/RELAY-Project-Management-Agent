import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { AppShell } from "@/components/relay/AppShell";

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

function AskProject() {
  const { user } = Route.useRouteContext();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [openCitation, setOpenCitation] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Resume the most recent conversation on load instead of always starting
  // blank — a session is only created lazily on the first message sent if
  // none exists yet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sessions = await listSessions(user.id);
        const mostRecent = sessions[0];
        if (!mostRecent || cancelled) return;

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

  return (
    <AppShell user={user} title="Ask project" padded={false}>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-6">
        <p className="section-label">Conversation · grounded in this project&apos;s records</p>

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
                <div className="rounded-xl rounded-bl-sm border border-border bg-card px-3.5 py-2.5 text-[13px] leading-relaxed text-ink">
                  {msg.text}{" "}
                  {msg.sources.map((s) => (
                    <button
                      key={s.source_doc_id}
                      type="button"
                      onClick={() =>
                        setOpenCitation(openCitation === s.source_doc_id ? null : s.source_doc_id)
                      }
                      className="mx-0.5 rounded-[3px] bg-brand-soft px-[5px] py-[1px] font-mono text-[11px] font-semibold text-brand"
                    >
                      [{s.source_doc_id}]
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
          Permission is checked <span className="font-medium text-ink">before</span> retrieval, and
          each retrieved chunk&apos;s provenance is re-checked against live permissions. Response
          time is normalised, so a denial and a genuine &quot;nothing found&quot; are
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
    </AppShell>
  );
}
