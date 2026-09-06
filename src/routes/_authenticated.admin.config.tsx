import { createFileRoute } from "@tanstack/react-router";
import { Database, GitBranch, RadioTower, Wrench } from "lucide-react";
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

const jiraEndpoint = "mcp://jira.internal.relay.dev:7443";
const githubEndpoint = "mcp://github.internal.relay.dev:7443";
const inferenceModel = "llama3.1:8b (Ollama, local)";
const citedAnswerModel = "Gemini 1.5 Pro";

function Configuration() {
  const { user } = Route.useRouteContext();
  return (
    <AppShell user={user} title="Configuration">
      <PageSection label="Connected sources">
        <div className="grid grid-cols-2 gap-4">
          <Panel title="Jira" icon={<Wrench className="size-3.5 text-mute" />}>
            <p className="text-[13px] text-mute">{jiraEndpoint}</p>
          </Panel>
          <Panel title="GitHub" icon={<GitBranch className="size-3.5 text-mute" />}>
            <p className="text-[13px] text-mute">{githubEndpoint}</p>
          </Panel>
        </div>
      </PageSection>

      <PageSection label="Models">
        <div className="grid grid-cols-2 gap-4">
          <Panel title="Local inference" icon={<Database className="size-3.5 text-mute" />}>
            <p className="text-[13px] text-mute">{inferenceModel}</p>
          </Panel>
          <Panel title="Cited answers" icon={<RadioTower className="size-3.5 text-mute" />}>
            <p className="text-[13px] text-mute">{citedAnswerModel}</p>
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
