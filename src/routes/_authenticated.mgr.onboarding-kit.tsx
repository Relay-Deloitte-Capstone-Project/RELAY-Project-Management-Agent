import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Rocket, Save, Sparkles, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/relay/AppShell";
import { Chip, GhostButton, PageSection, Panel } from "@/components/relay/primitives";
import {
  OnboardingCommonSections,
  OnboardingFirstWeek,
  OnboardingSectionNav,
  type CommonContent,
  type Kit,
  type PersonalContent,
} from "@/components/relay/OnboardingKitBody";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useMyProject } from "@/lib/admin/useMyProject";

const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

export const Route = createFileRoute("/_authenticated/mgr/onboarding-kit")({
  head: () => ({
    meta: [
      { title: "Onboarding kit — Relay" },
      {
        name: "description",
        content: "Capture a one-time onboarding record for a developer joining the team.",
      },
    ],
  }),
  component: OnboardingKitPage,
});

type RosterEntry = {
  name: string;
  email: string;
  role: string;
  is_new: boolean;
  has_kit: boolean;
  kit_updated_at: string | null;
};

type FirstTicketPreview = PersonalContent & { suggested_buddy?: { name: string; email: string } | null };

const EMPTY_PERSONAL: PersonalContent = { first_ticket: null, prs_for_first_ticket: [] };

function OnboardingKitPage() {
  const { user } = Route.useRouteContext();
  const { project } = useMyProject(user.email);
  const engagementId = project?.engagement_id ?? null;

  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [selectedEmail, setSelectedEmail] = useState<string>("");

  const [common, setCommon] = useState<CommonContent | null>(null);
  const [commonLoading, setCommonLoading] = useState(true);
  const [teamNormsDraft, setTeamNormsDraft] = useState("");
  const [envSetupDraft, setEnvSetupDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  const [frozenKit, setFrozenKit] = useState<Kit | null>(null);
  const [personalPreview, setPersonalContent] = useState<PersonalContent>(EMPTY_PERSONAL);
  const [suggestedBuddy, setSuggestedBuddy] = useState<{ name: string; email: string } | null>(null);
  const [buddyOverride, setBuddyOverride] = useState<string>("");
  const [personalLoading, setPersonalLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const loadRoster = () => {
    if (!engagementId) return;
    setRosterLoading(true);
    fetch(`${API_URL}/api/onboarding/roster?engagement_id=${engagementId}`)
      .then((r) => r.json())
      .then((rows: RosterEntry[]) => setRoster(rows))
      .catch(() => toast.error("Couldn't load the team roster"))
      .finally(() => setRosterLoading(false));
  };
  useEffect(loadRoster, [engagementId]);

  // Project-common sections load once per engagement, independent of who's
  // selected — they describe the project, not any one person.
  const loadCommon = () => {
    if (!engagementId) return;
    setCommonLoading(true);
    fetch(`${API_URL}/api/onboarding/common?engagement_id=${engagementId}`)
      .then((r) => r.json())
      .then((data: CommonContent) => {
        setCommon(data);
        setTeamNormsDraft(data.team_norms);
        setEnvSetupDraft(data.env_setup);
      })
      .catch(() => toast.error("Couldn't load project orientation"))
      .finally(() => setCommonLoading(false));
  };
  useEffect(loadCommon, [engagementId]);

  const selected = useMemo(() => roster.find((r) => r.email === selectedEmail) ?? null, [roster, selectedEmail]);

  // Selecting someone with an existing kit shows exactly what was frozen
  // for them (the manager's review view). Selecting someone new shows a
  // live, unsaved preview of just the personal section instead.
  useEffect(() => {
    setBuddyOverride("");
    if (!engagementId || !selectedEmail || !selected) {
      setFrozenKit(null);
      setPersonalContent(EMPTY_PERSONAL);
      setSuggestedBuddy(null);
      return;
    }
    if (selected.has_kit) {
      setPersonalLoading(true);
      fetch(`${API_URL}/api/onboarding/kits?engagement_id=${engagementId}&developer_email=${encodeURIComponent(selectedEmail)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("none"))))
        .then((data: Kit) => setFrozenKit(data))
        .catch(() => setFrozenKit(null))
        .finally(() => setPersonalLoading(false));
    } else {
      setFrozenKit(null);
      setPersonalLoading(true);
      fetch(
        `${API_URL}/api/onboarding/preview-first-ticket?engagement_id=${engagementId}&developer_email=${encodeURIComponent(selectedEmail)}&developer_name=${encodeURIComponent(selected.name)}`,
      )
        .then((r) => r.json())
        .then((data: FirstTicketPreview) => {
          setPersonalContent(data);
          setSuggestedBuddy(data.suggested_buddy ?? null);
        })
        .catch(() => {
          setPersonalContent(EMPTY_PERSONAL);
          setSuggestedBuddy(null);
        })
        .finally(() => setPersonalLoading(false));
    }
  }, [engagementId, selectedEmail]);

  const handleSaveNotes = async () => {
    if (!engagementId) return;
    setSavingNotes(true);
    try {
      await fetch(`${API_URL}/api/onboarding/project-notes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engagement_id: engagementId,
          team_norms: teamNormsDraft,
          env_setup: envSetupDraft,
          updated_by: user.email,
        }),
      });
      setCommon((c) => (c ? { ...c, team_norms: teamNormsDraft, env_setup: envSetupDraft } : c));
      toast.success("Saved — applies to every kit created from now on.");
    } catch {
      toast.error("Couldn't save.");
    } finally {
      setSavingNotes(false);
    }
  };

  const handleCreate = async () => {
    if (!engagementId || !selectedEmail) return;
    setCreating(true);
    try {
      const res = await fetch(`${API_URL}/api/onboarding/kits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engagement_id: engagementId,
          developer_email: selectedEmail,
          created_by: user.email,
          buddy_email: buddyOverride || undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: Kit = await res.json();
      setFrozenKit(data);
      loadRoster();
      toast.success(`Onboarding kit ${selected?.has_kit ? "re-created" : "added"} for ${data.developer_name}`);
    } catch {
      toast.error("Couldn't build the onboarding kit — check the backend is running.");
    } finally {
      setCreating(false);
    }
  };

  const notesUnsaved = teamNormsDraft !== common?.team_norms || envSetupDraft !== common?.env_setup;

  // Common sections: always the live project view, unless a frozen kit is
  // selected — then show exactly what was captured for that person.
  const commonToShow: CommonContent | null = frozenKit ? frozenKit.content : common;
  const personalToShow: PersonalContent = frozenKit
    ? frozenKit.content
    : { ...personalPreview, buddy: buddyOverride ? roster.find((r) => r.email === buddyOverride) ?? null : suggestedBuddy };

  const buddyCandidates = roster.filter((r) => r.email !== selectedEmail);

  return (
    <AppShell user={user} title="Onboarding kit">
      <PageSection
        label="Onboarding kit"
        subtitle="Project orientation below is live and the same for everyone. Only the suggested first ticket, its PRs, and the onboarding buddy depend on who you pick — and the whole thing freezes the moment you add someone, so you can always review exactly what they were given."
      >
        <Panel title="Who's joining" icon={<Users className="size-4" />}>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[240px]">
              <label className="mb-1 block text-[11px] font-medium text-mute">Team member</label>
              <Select value={selectedEmail} onValueChange={setSelectedEmail} disabled={rosterLoading}>
                <SelectTrigger className="h-9 text-[13px]">
                  <SelectValue placeholder={rosterLoading ? "Loading roster…" : "Select a team member"} />
                </SelectTrigger>
                <SelectContent>
                  {roster.map((r) => (
                    <SelectItem key={r.email} value={r.email}>
                      <span className="flex items-center gap-2">
                        {r.name}
                        {r.is_new ? <Chip tone="brand">New member</Chip> : null}
                        {r.has_kit ? <Chip tone="success">Kit created</Chip> : null}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedEmail && !selected?.has_kit ? (
              <div className="min-w-[220px]">
                <label className="mb-1 block text-[11px] font-medium text-mute">Onboarding buddy</label>
                <Select
                  value={buddyOverride || suggestedBuddy?.email || ""}
                  onValueChange={setBuddyOverride}
                  disabled={personalLoading}
                >
                  <SelectTrigger className="h-9 text-[13px]">
                    <SelectValue placeholder="Auto-suggested" />
                  </SelectTrigger>
                  <SelectContent>
                    {buddyCandidates.map((r) => (
                      <SelectItem key={r.email} value={r.email}>
                        {r.name}
                        {r.email === suggestedBuddy?.email ? " (suggested)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <GhostButton
              tone="brand"
              onClick={handleCreate}
              disabled={!selectedEmail || creating}
              className="h-9 px-3 text-[13px]"
            >
              {creating ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {selected?.has_kit ? "Re-create kit" : "Add to onboarding"}
            </GhostButton>
          </div>
          {selected?.has_kit && selected.kit_updated_at ? (
            <p className="mt-2 text-[12px] text-mute">
              Kit last created {new Date(selected.kit_updated_at).toLocaleString()} — showing exactly what was
              frozen for {selected.name} below. Re-creating overwrites it with current data; this never happens
              automatically.
            </p>
          ) : selectedEmail ? (
            <p className="mt-2 text-[12px] text-mute">
              No kit yet for {selected?.name} — the first-week section below is a live preview, not saved until you
              click "Add to onboarding."
            </p>
          ) : null}
        </Panel>
      </PageSection>

      <PageSection label="Project notes — the two sections you write by hand">
        <div className="grid gap-4 md:grid-cols-2">
          <Panel title="Team norms">
            <Textarea
              value={teamNormsDraft}
              onChange={(e) => setTeamNormsDraft(e.target.value)}
              placeholder="Where does the team communicate day-to-day? What's expected on PR reviews and branch naming?"
              className="min-h-[100px] text-[13px]"
            />
          </Panel>
          <Panel title="Environment & setup">
            <Textarea
              value={envSetupDraft}
              onChange={(e) => setEnvSetupDraft(e.target.value)}
              placeholder="Repo clone URL, install steps, required env vars, how to run tests locally."
              className="min-h-[100px] text-[13px]"
            />
          </Panel>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <p className="text-[11px] text-mute">
            Set once per project, not per person — every kit created from now on picks up whatever's saved here.
          </p>
          <Button size="sm" variant="outline" onClick={handleSaveNotes} disabled={savingNotes || !notesUnsaved}>
            {savingNotes ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Save for this project
          </Button>
        </div>
      </PageSection>

      {commonLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-mute" />
        </div>
      ) : null}

      {commonToShow ? <OnboardingSectionNav /> : null}
      {commonToShow ? <OnboardingCommonSections content={commonToShow} /> : null}

      {personalLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="size-4 animate-spin text-mute" />
        </div>
      ) : selectedEmail ? (
        <OnboardingFirstWeek content={personalToShow} />
      ) : commonToShow ? (
        <PageSection label="Your first week">
          <Panel>
            <p className="text-[13px] text-mute">
              <Rocket className="mr-1.5 inline size-3.5" />
              Select a team member above to preview their suggested first ticket and onboarding buddy — this is the
              only part of the kit that depends on who's joining.
            </p>
          </Panel>
        </PageSection>
      ) : null}
    </AppShell>
  );
}
