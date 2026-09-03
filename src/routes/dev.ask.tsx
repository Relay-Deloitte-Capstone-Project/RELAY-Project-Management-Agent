import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import { conversation } from "@/lib/mockData";

export const Route = createFileRoute("/dev/ask")({
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

function AskProject() {
  const [openCitation, setOpenCitation] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  return (
    <AppShell role="developer" title="Ask project" padded={false}>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-6">
        <p className="section-label">Conversation · grounded in 1,247 tickets</p>

        {conversation.map((msg, i) => {
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
                <div className="mt-1 text-[10px] text-mute">
                  Abstained · 0 sources · 0.9s (timing normalised)
                </div>
              </div>
            );
          }

          return (
            <div key={i} className="max-w-[80%]">
              <div className="rounded-xl rounded-bl-sm border border-border bg-card px-3.5 py-2.5 text-[13px] leading-relaxed text-ink">
                {msg.text}{" "}
                {msg.citations?.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setOpenCitation(openCitation === c.key ? null : c.key)}
                    className="mx-0.5 rounded-[3px] bg-brand-soft px-[5px] py-[1px] font-mono text-[10px] font-semibold text-brand"
                  >
                    [{c.key}]
                  </button>
                ))}
              </div>
              {msg.citations
                ?.filter((c) => c.key === openCitation)
                .map((c) => (
                  <div
                    key={c.key}
                    className="mt-2 border-l-[3px] border-brand bg-surface-sunken p-2 text-[11px] leading-relaxed text-mute"
                  >
                    <span className="font-mono font-semibold text-brand">{c.key}</span> —{" "}
                    {c.snippet}
                  </div>
                ))}
              <div className="mt-1 text-[10px] text-mute">{msg.tier}</div>
            </div>
          );
        })}

        <div className="mt-2 max-w-[80%] rounded-lg border border-border bg-surface-sunken p-3 text-[11px] leading-relaxed text-mute">
          Permission is checked <span className="font-medium text-ink">before</span> retrieval, and
          each retrieved chunk&apos;s provenance is re-checked against live permissions. Response
          time is normalised, so a denial and a genuine &quot;nothing found&quot; are
          indistinguishable.
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setDraft("");
        }}
        className="flex h-14 shrink-0 items-center gap-3 border-t border-border px-6"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask anything about this project..."
          className="h-9 flex-grow rounded-md border border-border bg-card px-3 text-[12px] text-ink outline-none transition-colors duration-150 placeholder:text-mute focus:border-brand"
        />
        <button
          type="submit"
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand px-3.5 text-[12px] font-medium text-brand-foreground transition-transform duration-100 active:scale-[0.98] [&_svg]:size-3.5"
        >
          Send <ArrowRight />
        </button>
      </form>
    </AppShell>
  );
}
