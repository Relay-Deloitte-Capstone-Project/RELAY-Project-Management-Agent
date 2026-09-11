import { createFileRoute } from "@tanstack/react-router";
import { Database, GitBranch, RadioTower, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import { PageSection, Panel } from "@/components/relay/primitives";

export const Route = createFileRoute("/_authenticated/admin/config")({
  head: () => ({
    meta: [
      { title: "Configuration — Relay" },
      {
        name: "description",
        content: "Connected data sources, model configuration and ingestion schedule.",
      },
      { property: "og:title", content: "Configuration — Relay" },
      { property: "og:description", content: "MCP endpoints, model and ingestion schedule." },
    ],
  }),
  component: Configuration,
});

const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

// No GitHub integration exists anywhere in this app — nothing real to show here.
const githubEndpoint = "Not connected";

type ProjectConfig = {
  jira_site: string | null;
  llm_provider: string | null;
  groq_model: string | null;
  gemini_model: string | null;
};

function Configuration() {
  const { user } = Route.useRouteContext();
  const [config, setConfig] = useState<ProjectConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/project/config`);
        if (!res.ok) return;
        const json: ProjectConfig = await res.json();
        if (!cancelled) setConfig(json);
      } catch {
        // Panels just show "Loading…" indefinitely — not critical enough for a retry UI here.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const primary = config?.llm_provider === "gemini" ? config?.gemini_model : config?.groq_model;
  const fallback = config?.llm_provider === "gemini" ? config?.groq_model : config?.gemini_model;

  return (
    <AppShell user={user} title="Configuration">
      <PageSection label="Connected sources">
        <div className="grid grid-cols-2 gap-4">
          <Panel title="Jira" icon={<Wrench className="size-3.5 text-mute" />}>
            <p className="text-[13px] text-mute">{config?.jira_site ?? "Loading…"}</p>
          </Panel>
          <Panel title="GitHub" icon={<GitBranch className="size-3.5 text-mute" />}>
            <p className="text-[13px] text-mute">{githubEndpoint}</p>
          </Panel>
        </div>
      </PageSection>

      <PageSection label="Models">
        <div className="grid grid-cols-2 gap-4">
          <Panel title="Primary provider" icon={<Database className="size-3.5 text-mute" />}>
            <p className="text-[13px] text-mute">{primary ?? "Loading…"}</p>
          </Panel>
          <Panel title="Fallback provider" icon={<RadioTower className="size-3.5 text-mute" />}>
            <p className="text-[13px] text-mute">{fallback ?? "Loading…"}</p>
          </Panel>
        </div>
      </PageSection>

      <PageSection label="Ingestion schedule">
        <Panel>
          <p className="text-[13px] leading-relaxed text-mute">
            Jira and GitHub sources re-ingest every 4 hours. PR threads re-ingest every hour.
            Configuration changes here are not yet wired to a backend in this preview — this page is
            read-only.
          </p>
        </Panel>
      </PageSection>
    </AppShell>
  );
}
