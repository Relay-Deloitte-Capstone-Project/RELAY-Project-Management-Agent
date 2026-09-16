// Shared render of an onboarding kit's content — used identically by the
// manager's preview (src/routes/_authenticated.mgr.onboarding-kit.tsx) and
// the developer's static, read-only view
// (src/routes/_authenticated.dev.onboarding-kit.tsx). A new hire sees
// exactly what the manager saw when they built it; this component is the
// guarantee of that, not two copies that can drift apart.
import { BookOpen, Bug, Compass, FolderGit2, GitPullRequest, KeyRound, Layers, Lightbulb, Map, ScrollText, Terminal, TriangleAlert, UserPlus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Chip, PageSection, Panel, SectionLabel } from "@/components/relay/primitives";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { id: "onboarding-orientation", label: "Orientation" },
  { id: "onboarding-team-codebase", label: "Team & codebase" },
  { id: "onboarding-first-week", label: "First week" },
];

// Sticky jump-nav so a 10+ panel kit doesn't require scrolling past
// everything to reach "Your first week." Same component on both the
// manager's page and the developer's static view — one nav, one behavior.
export function OnboardingSectionNav() {
  const [active, setActive] = useState(SECTIONS[0]!.id);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-10% 0px -75% 0px" },
    );
    const elements = SECTIONS.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => !!el);
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="sticky top-0 z-20 mb-4 flex gap-1 rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
      {SECTIONS.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
          className={cn(
            "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
            active === s.id ? "bg-brand-soft text-brand" : "text-mute hover:bg-surface-sunken hover:text-ink",
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

export type KitContent = {
  orientation: { summary: string; source: string };
  architecture_overview?: string | null;
  access_setup: {
    jira_url: string | null;
    jira_project_key: string | null;
    github_repo: string | null;
    github_url: string | null;
    note: string;
  };
  env_setup: string;
  glossary: { term: string; definition: string }[];
  team_norms: string;
  things_that_will_bite_you: { origin: "note" | "bug"; title: string; detail: string; ticket_key?: string }[];
  who_to_ask: { area: string; contact: string; detail: string }[];
  areas_in_motion: { area: string; commit_count: number; ticket_refs: string[] }[];
  coverage_guidance: string[];
  scope_summary: { name: string; acceptance_criteria: string | null }[];
  first_ticket: {
    key: string;
    summary: string;
    status: string;
    type?: string | null;
    priority?: string | null;
    description?: string | null;
    epic_key?: string | null;
    epic_title?: string | null;
    deliverable_key?: string | null;
    scope_status?: string | null;
    scope_reason?: string | null;
    ask_about_it?: string | null;
    reasons: string[];
    getting_started?: string[];
  } | null;
  prs_for_first_ticket: { number: string; title: string; url: string; relevance?: string }[];
  buddy?: { name: string; email: string } | null;
};

export type Kit = {
  developer_name: string;
  developer_email: string;
  created_at: string;
  updated_at: string;
  content: KitContent;
};

export type CommonContent = Omit<KitContent, "first_ticket" | "prs_for_first_ticket" | "buddy">;
export type PersonalContent = Pick<KitContent, "first_ticket" | "prs_for_first_ticket" | "buddy">;

// The project-level sections — identical regardless of which new hire is
// selected. Rendered on its own by the manager page (live, before anyone
// commits to a specific person) and as the first half of the full kit body.
export function OnboardingCommonSections({ content }: { content: CommonContent }) {
  return (
    <>
      <PageSection label="Orientation" className="scroll-mt-16" id="onboarding-orientation">
        <div className="grid gap-4 md:grid-cols-2">
          <Panel title="Project orientation" icon={<Compass className="size-4" />} className="md:col-span-2">
            <p className="text-[13px] leading-relaxed text-ink whitespace-pre-line">{content.orientation.summary}</p>
          </Panel>
          {content.architecture_overview ? (
            <Panel title="Architecture overview" icon={<Layers className="size-4" />} className="md:col-span-2">
              <p className="text-[13px] leading-relaxed text-ink whitespace-pre-line">{content.architecture_overview}</p>
            </Panel>
          ) : null}
          <Panel title="Access & setup" icon={<KeyRound className="size-4" />}>
            <div className="space-y-1.5 text-[13px]">
              {content.access_setup.jira_url ? (
                <a href={content.access_setup.jira_url} target="_blank" rel="noreferrer" className="block text-brand hover:underline">
                  Jira: {content.access_setup.jira_project_key}
                </a>
              ) : (
                <p className="text-mute">Jira board not linked yet for this project.</p>
              )}
              {content.access_setup.github_url ? (
                <a href={content.access_setup.github_url} target="_blank" rel="noreferrer" className="block text-brand hover:underline">
                  GitHub: {content.access_setup.github_repo}
                </a>
              ) : (
                <p className="text-mute">GitHub repo not linked yet for this project.</p>
              )}
              <p className="pt-1 text-[12px] text-mute">{content.access_setup.note}</p>
            </div>
          </Panel>
          <Panel title="Glossary" icon={<BookOpen className="size-4" />}>
            {content.glossary.length ? (
              <dl className="space-y-2 text-[13px]">
                {content.glossary.map((g) => (
                  <div key={g.term}>
                    <dt className="font-semibold text-ink">{g.term}</dt>
                    <dd className="text-mute">{g.definition}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-[13px] text-mute">No project documents to generate a glossary from yet.</p>
            )}
          </Panel>
          <Panel title="Environment & setup" icon={<Terminal className="size-4" />}>
            <p className="text-[13px] leading-relaxed text-ink whitespace-pre-line">{content.env_setup}</p>
          </Panel>
          <Panel title="Team norms" icon={<ScrollText className="size-4" />}>
            <p className="text-[13px] leading-relaxed text-ink whitespace-pre-line">{content.team_norms}</p>
          </Panel>
          <Panel title="Things that will bite you" icon={<TriangleAlert className="size-4" />} className="md:col-span-2">
            {content.things_that_will_bite_you.length ? (
              <div className="scroll-fade max-h-[420px] space-y-2 overflow-y-auto pr-1">
                {content.things_that_will_bite_you.map((item, i) => (
                  <div key={i} className="rounded-lg bg-surface-sunken px-3 py-2">
                    <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                      {item.origin === "bug" ? <Bug className="size-3.5 text-danger" /> : <Lightbulb className="size-3.5 text-warning" />}
                      {item.title}
                    </div>
                    <p className="mt-0.5 text-[12px] text-mute">{item.detail}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-mute">No approved notes or recently fixed bugs on record yet.</p>
            )}
          </Panel>
        </div>
      </PageSection>

      <PageSection label="The team & codebase" className="scroll-mt-16" id="onboarding-team-codebase">
        <div className="grid gap-4 md:grid-cols-2">
          <Panel title="Who to ask about what" icon={<Users className="size-4" />}>
            {content.who_to_ask.length ? (
              <div className="space-y-2 text-[13px]">
                {content.who_to_ask.map((w) => (
                  <div key={w.area} className="flex items-start justify-between gap-2">
                    <span className="text-ink">{w.area}</span>
                    <span className="text-right text-mute">{w.detail}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-mute">Not enough commit history yet to infer ownership.</p>
            )}
          </Panel>
          <Panel title="Areas in motion" icon={<FolderGit2 className="size-4" />}>
            {content.areas_in_motion.length ? (
              <div className="space-y-2 text-[13px]">
                {content.areas_in_motion.map((a) => (
                  <div key={a.area} className="flex items-start justify-between gap-2">
                    <span className="text-ink">{a.area}</span>
                    <span className="text-mute">{a.commit_count} commits</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-mute">No recent commit activity found yet.</p>
            )}
          </Panel>
          <Panel title="Coverage guidance" icon={<Map className="size-4" />} className="md:col-span-2">
            <ul className="list-disc space-y-1.5 pl-4 text-[13px] text-ink">
              {content.coverage_guidance.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          </Panel>
          <Panel title="Scope summary" icon={<ScrollText className="size-4" />} className="md:col-span-2">
            {content.scope_summary.length ? (
              <div className="space-y-2">
                {content.scope_summary.map((s) => (
                  <div key={s.name} className="text-[13px]">
                    <span className="font-medium text-ink">{s.name}</span>
                    {s.acceptance_criteria ? <p className="text-mute">{s.acceptance_criteria}</p> : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-mute">No SOW deliverables uploaded for this engagement yet.</p>
            )}
          </Panel>
        </div>
      </PageSection>
    </>
  );
}

// The one genuinely person-specific part — depends on who's joining and
// what they'll actually work on. Rendered separately so the manager page
// can show it as a live, unsaved preview while common sections stay put.
export function OnboardingFirstWeek({ content }: { content: PersonalContent }) {
  return (
    <PageSection
      id="onboarding-first-week"
      className="scroll-mt-16"
      label="Your first week"
      subtitle="Nobody expects this to ship fast — the goal this week is understanding the area you're in, not speed."
    >
      <div className="grid gap-4 md:grid-cols-2">
        {content.buddy ? (
          <Panel title="Your onboarding buddy" icon={<UserPlus className="size-4" />} className="md:col-span-2">
            <p className="text-[13px] text-ink">
              <span className="font-semibold">{content.buddy.name}</span> — reach out to them first with any
              question you're not sure who else to ask.
            </p>
          </Panel>
        ) : null}
        <Panel title="Suggested first ticket" className="md:col-span-2">
          {content.first_ticket ? (
            <div className="space-y-3">
              <div>
                <p className="text-[13px] font-semibold text-ink">
                  {content.first_ticket.key} — {content.first_ticket.summary}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {content.first_ticket.status ? <Chip tone="brand">{content.first_ticket.status}</Chip> : null}
                  {content.first_ticket.type ? <Chip>{content.first_ticket.type}</Chip> : null}
                  {content.first_ticket.priority ? <Chip>{content.first_ticket.priority} priority</Chip> : null}
                  {content.first_ticket.epic_title ? (
                    <Chip tone="violet">
                      {content.first_ticket.deliverable_key ? `${content.first_ticket.deliverable_key}: ` : ""}
                      {content.first_ticket.epic_title}
                    </Chip>
                  ) : null}
                  {content.first_ticket.scope_status ? (
                    <Chip tone={content.first_ticket.scope_status === "in_scope" ? "success" : "warning"}>
                      {content.first_ticket.scope_status.replace(/_/g, " ")}
                    </Chip>
                  ) : null}
                </div>
              </div>

              {content.first_ticket.description ? (
                <div>
                  <SectionLabel>What the ticket says</SectionLabel>
                  <p className="rounded-lg bg-surface-sunken px-3 py-2 text-[13px] leading-relaxed whitespace-pre-line text-ink">
                    {content.first_ticket.description}
                  </p>
                </div>
              ) : null}

              {content.first_ticket.scope_reason ? (
                <div>
                  <SectionLabel>Why it's in scope</SectionLabel>
                  <p className="text-[13px] text-mute">{content.first_ticket.scope_reason}</p>
                </div>
              ) : null}

              <div>
                <SectionLabel>Why this ticket for you</SectionLabel>
                <ul className="list-disc space-y-1 pl-4 text-[13px] text-mute">
                  {content.first_ticket.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>

              {content.first_ticket.getting_started?.length ? (
                <div>
                  <SectionLabel>How to get started</SectionLabel>
                  <ol className="list-decimal space-y-1 pl-4 text-[13px] text-ink">
                    {content.first_ticket.getting_started.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-[13px] text-mute">No suitable unassigned ticket found — pick one manually with them.</p>
          )}
        </Panel>
        <Panel title="PRs behind your first ticket" icon={<GitPullRequest className="size-4" />} className="md:col-span-2">
          {content.prs_for_first_ticket.length ? (
            <>
              {content.prs_for_first_ticket[0]?.relevance ? (
                <p className="mb-2 text-[12px] text-mute italic">{content.prs_for_first_ticket[0].relevance}</p>
              ) : null}
              <ul className="space-y-1.5 text-[13px]">
                {content.prs_for_first_ticket.map((pr) => (
                  <li key={pr.number}>
                    <a href={pr.url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                      #{pr.number} {pr.title}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-[13px] text-mute">No PRs found referencing this ticket yet.</p>
          )}
        </Panel>
      </div>
    </PageSection>
  );
}

// Full kit — both halves together. Used by the developer's static view,
// where there's always exactly one frozen record with both parts present.
export function OnboardingKitBody({ content }: { content: KitContent }) {
  return (
    <>
      <OnboardingCommonSections content={content} />
      <OnboardingFirstWeek content={content} />
    </>
  );
}
