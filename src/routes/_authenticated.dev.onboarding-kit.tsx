import { createFileRoute } from "@tanstack/react-router";
import { Rocket } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/relay/AppShell";
import { EmptyState, PageSection, Panel, SkeletonPanel } from "@/components/relay/primitives";
import { OnboardingKitBody, OnboardingSectionNav, type Kit } from "@/components/relay/OnboardingKitBody";
import { useMyProject } from "@/lib/admin/useMyProject";

const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

export const Route = createFileRoute("/_authenticated/dev/onboarding-kit")({
  head: () => ({
    meta: [
      { title: "Onboarding kit — Relay" },
      {
        name: "description",
        content: "Everything you need to know from day one — set by your manager, not something that changes under you.",
      },
    ],
  }),
  component: DevOnboardingKit,
});

function DevOnboardingKit() {
  const { user } = Route.useRouteContext();
  const { project, loading: projectLoading } = useMyProject(user.email);
  const engagementId = project?.engagement_id ?? null;

  const [kit, setKit] = useState<Kit | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!engagementId) return;
    setLoading(true);
    fetch(`${API_URL}/api/onboarding/kits?engagement_id=${engagementId}&developer_email=${encodeURIComponent(user.email)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("none"))))
      .then((data: Kit) => setKit(data))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [engagementId, user.email]);

  return (
    <AppShell user={user} title="Onboarding kit">
      <PageSection
        label="Onboarding kit"
        subtitle={
          kit
            ? `Captured for you on ${new Date(kit.created_at).toLocaleDateString()} — a fixed snapshot, not a live feed, so it stays the same as you work through it.`
            : undefined
        }
      >
        {projectLoading || loading ? (
          <div className="space-y-4">
            <SkeletonPanel lines={4} />
            <SkeletonPanel lines={3} />
          </div>
        ) : null}

        {!projectLoading && !loading && notFound ? (
          <Panel>
            <EmptyState
              icon={<Rocket />}
              body="Your manager hasn't set this up yet — ask them to add you from the Onboarding kit page."
            />
          </Panel>
        ) : null}
      </PageSection>

      {kit ? (
        <>
          <OnboardingSectionNav />
          <OnboardingKitBody content={kit.content} />
        </>
      ) : null}
    </AppShell>
  );
}
