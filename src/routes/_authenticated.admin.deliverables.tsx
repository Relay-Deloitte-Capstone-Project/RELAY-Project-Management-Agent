import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/relay/AppShell";
import { DeliverablesBoard } from "@/components/relay/DeliverablesBoard";

export const Route = createFileRoute("/_authenticated/admin/deliverables")({
  head: () => ({
    meta: [
      { title: "Deliverables — Relay" },
      {
        name: "description",
        content: "Every deliverable extracted from a project's uploaded SOWs.",
      },
      { property: "og:title", content: "Deliverables — Relay" },
      { property: "og:description", content: "Deliverables grouped by their source SOW document." },
    ],
  }),
  component: AdminDeliverables,
});

function AdminDeliverables() {
  const { user } = Route.useRouteContext();
  return (
    <AppShell user={user} title="Deliverables">
      <DeliverablesBoard />
    </AppShell>
  );
}
