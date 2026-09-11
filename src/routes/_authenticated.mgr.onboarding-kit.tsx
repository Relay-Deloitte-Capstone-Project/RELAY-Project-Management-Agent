import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, BookOpen, Compass, Lightbulb, TriangleAlert, Users } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import { GhostButton, PageSection, Panel, TicketKey } from "@/components/relay/primitives";
import { Input } from "@/components/ui/input";
import {
  ACTIVE_EPICS,
  ACTIVE_FILES,
  COVERAGE_MAP,
  KEY_PRS,
  LANDMINES,
  MILESTONES,
  OWNERSHIP,
  PROJECT_ORIENTATION,
  RECENT_FIXES,
  REVIEW_OWNERSHIP,
  SUGGESTED_FIRST_TICKET,
} from "@/lib/mgr/onboardingKitMock";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/mgr/onboarding-kit")({
  head: () => ({
    meta: [
      { title: "Onboarding kit — Relay" },
      {
        name: "description",
        content: "Generate a project orientation kit for a developer joining the team.",
      },
    ],
  }),
  component: OnboardingKit,
});

function epicTone(pct: number) {
  if (pct > 70) return "bg-success";
  if (pct >= 40) return "bg-warning";
  return "bg-danger";
}

function OnboardingKit() {
  const { user } = Route.useRouteContext();
  const [nameInput, setNameInput] = useState("Priya Sharma");
  const [generatedFor, setGeneratedFor] = useState("Priya Sharma");

  return (
    <AppShell user={user} title="Onboarding kit">
      <PageSection>
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <label className="section-label">New developer name</label>
            <Input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              className="w-64"
              placeholder="e.g. Priya Sharma"
            />
          </div>
          <GhostButton
            tone="brand"
            onClick={() => setGeneratedFor(nameInput.trim() || "this developer")}
          >
            Generate kit <ArrowRight />
          </GhostButton>
        </div>
        <p className="mt-2 text-[12px] text-mute italic">
          Onboarding kit for {generatedFor} — assembled from Jira, GitHub and approved scratchpad
          notes.
        </p>
      </PageSection>

      {/* Section 1: Project orientation */}
      <PageSection label="Project orientation">
        <Panel className="border-l-4 border-l-brand">
          <h3 className="font-serif text-[16px] font-semibold text-ink">
            {PROJECT_ORIENTATION.title}
          </h3>
          <p className="mt-2 font-serif text-[14px] leading-relaxed whitespace-pre-line text-ink/90">
            {PROJECT_ORIENTATION.body}
          </p>
        </Panel>

        <div className="mt-4">
          <Panel title="Active work this sprint" icon={<Compass className="size-3.5 text-mute" />}>
            <div className="space-y-3">
              {ACTIVE_EPICS.map((e) => (
                <div key={e.title}>
                  <div className="mb-1 flex items-center justify-between text-[13px]">
                    <span className="font-medium text-ink">{e.title}</span>
                    <span className="text-mute">
                      {e.status} · {e.tickets} open tickets
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-surface-sunken">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-700",
                        epicTone(e.value),
                      )}
                      style={{ width: `${e.value}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="mt-4">
          <Panel title="Known landmines" icon={<TriangleAlert className="size-3.5 text-warning" />}>
            <div className="space-y-2">
              {LANDMINES.map((l) => (
                <div
                  key={l.title}
                  className="rounded-r-lg border-l-4 border-l-warning bg-warning-soft/30 px-4 py-3"
                >
                  <p className="text-[13px] font-medium text-ink">⚠ {l.title}</p>
                  <p className="mt-0.5 pl-4 text-[12px] text-mute">{l.detail}</p>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </PageSection>

      {/* Section 2: The team */}
      <PageSection label="The team">
        <div className="grid grid-cols-2 gap-4">
          <Panel title="Who owns what" icon={<Users className="size-3.5 text-mute" />}>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="section-label pb-2 pr-3 font-normal">Area</th>
                  <th className="section-label pb-2 pr-3 font-normal">Primary owner</th>
                  <th className="section-label pb-2 font-normal">Contact</th>
                </tr>
              </thead>
              <tbody>
                {OWNERSHIP.map((o) => (
                  <tr key={o.area} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3 text-[13px] text-ink">{o.area}</td>
                    <td className="py-2 pr-3 text-[13px] font-medium text-ink">{o.owner}</td>
                    <td className="py-2 text-[12px] text-mute">{o.contact}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-mute italic">
              This is inferred from commit history, not self-reported.
            </p>
          </Panel>

          <Panel title="Who reviews what" icon={<Users className="size-3.5 text-mute" />}>
            <ul className="space-y-2.5">
              {REVIEW_OWNERSHIP.map((r) => (
                <li key={r.area} className="flex items-center justify-between text-[13px]">
                  <span className="text-mute">{r.area}</span>
                  <span className="font-medium text-ink">
                    → {r.reviewer} ({r.prCount} PRs)
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </PageSection>

      {/* Section 3: The codebase */}
      <PageSection label="The codebase">
        <div className="grid grid-cols-2 gap-4">
          <Panel
            title="Most active files this sprint"
            icon={<BookOpen className="size-3.5 text-mute" />}
          >
            <ul>
              {ACTIVE_FILES.map((f) => (
                <li
                  key={f.path}
                  className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0"
                >
                  <span className="truncate font-mono text-[12px] text-ink">{f.path}</span>
                  <span className="shrink-0 text-[11px] text-mute">{f.commits} commits</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-mute italic">
              Start here to understand current focus.
            </p>
          </Panel>

          <Panel
            title="Recent bugs fixed — read these first"
            icon={<BookOpen className="size-3.5 text-mute" />}
          >
            <ul>
              {RECENT_FIXES.map((f) => (
                <li key={f.key} className="border-b border-border py-2 last:border-0">
                  <div className="flex items-center gap-2">
                    <TicketKey>{f.key}</TicketKey>
                    <span className="flex-grow text-[13px] text-ink">{f.summary}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-mute">
                    Fixed in <span className="font-mono text-brand">{f.fixedIn}</span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-mute italic">
              Reading bug fixes is the fastest way to understand the system's weak points.
            </p>
          </Panel>
        </div>

        <div className="mt-4">
          <Panel title="Coverage map">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <div className="section-label mb-2">Well documented (safe to explore)</div>
                <div className="space-y-1.5">
                  {COVERAGE_MAP.wellDocumented.map((c) => (
                    <div key={c.label} className="flex items-center justify-between text-[13px]">
                      <span className="text-ink">{c.label}</span>
                      <span className="font-medium text-success">{c.value}% linked</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="section-label mb-2">Dark areas (no linked commits)</div>
                <div className="space-y-1.5">
                  {COVERAGE_MAP.darkAreas.map((c) => (
                    <div key={c.label} className="flex items-center justify-between text-[13px]">
                      <span className="text-ink">{c.label}</span>
                      <span
                        className={cn("font-medium", c.value < 20 ? "text-danger" : "text-warning")}
                      >
                        {c.value}% linked {c.value < 20 ? "⚠️" : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <p className="mt-3 text-[11px] text-mute italic">
              The auth module has almost no linked commits — high knowledge risk area.
            </p>
          </Panel>
        </div>
      </PageSection>

      {/* Section 4: Your first week */}
      <PageSection label="Your first week">
        <Panel className="border-l-4 border-l-brand">
          <h3 className="text-[14px] font-semibold text-ink">
            {SUGGESTED_FIRST_TICKET.key} — {SUGGESTED_FIRST_TICKET.title}
          </h3>
          <p className="section-label mt-3 mb-1.5">Why this ticket</p>
          <ul className="space-y-1">
            {SUGGESTED_FIRST_TICKET.reasons.map((r) => (
              <li key={r} className="flex items-start gap-2 text-[13px] text-ink">
                <span className="mt-0.5 text-success">✓</span>
                {r}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-mute">
            Status: {SUGGESTED_FIRST_TICKET.status} · Priority: {SUGGESTED_FIRST_TICKET.priority} ·
            Epic: {SUGGESTED_FIRST_TICKET.epic}
          </p>
          <p className="mt-2 text-[11px] text-mute italic">
            This recommendation is based on ticket complexity, documentation coverage, and current
            team load.
          </p>
        </Panel>

        <div className="mt-4">
          <Panel title="Key PRs to read first">
            <ul>
              {KEY_PRS.map((pr) => (
                <li key={pr.key} className="border-b border-border py-2 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[12.5px] font-semibold text-brand">
                      {pr.key}
                    </span>
                    <span className="flex-grow text-[13px] text-ink">{pr.title}</span>
                    <span className="shrink-0 text-[11px] text-mute">{pr.comments} comments</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-mute">{pr.note}</div>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-mute italic">
              These are where the biggest technical debates happened. Reading them gives you 80% of
              the architectural reasoning.
            </p>
          </Panel>
        </div>

        <div className="mt-4">
          <Panel title="30-day milestones" icon={<Lightbulb className="size-3.5 text-mute" />}>
            <ul className="space-y-2">
              {MILESTONES.map((m) => (
                <li key={m.day} className="flex items-center gap-2 text-[13px] text-ink">
                  <span className="size-3.5 shrink-0 rounded-sm border border-border" />
                  <span className="font-semibold text-mute">{m.day}:</span>
                  {m.label}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-mute italic">
              Teams that set explicit milestones cut new-hire ramp time from 6 weeks to 10 days.
            </p>
          </Panel>
        </div>
      </PageSection>
    </AppShell>
  );
}
