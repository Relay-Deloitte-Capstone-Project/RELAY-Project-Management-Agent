// Real staffing roster for one project — shared by the setup wizard's Team
// step and the All Projects detail panel's Team tab, so "who's on this
// engagement" is one persisted list (public.project_members) instead of the
// wizard's old component-state-only mock that reset on every page load.
import { Loader2, TriangleAlert, Trash2, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { GhostButton, SectionLabel } from "@/components/relay/primitives";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addMember,
  fetchMembers,
  removeMember,
  type MemberConflict,
  type MemberRole,
  type ProjectMember,
} from "@/lib/admin/backendProjects";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES: MemberRole[] = ["Manager", "Developer", "QA", "Designer", "Observer"];
const DEPARTMENTS = ["Engineering", "QA", "Design", "Product", "Data", "DevOps", "Client Success"];
const DEFAULT_DEPARTMENT: string = DEPARTMENTS[0] ?? "Engineering";

const roleTone: Record<MemberRole, string> = {
  Manager: "bg-brand-soft text-brand",
  Developer: "bg-success-soft text-success",
  QA: "bg-warning-soft text-warning",
  Designer: "bg-violet-soft text-brand",
  Observer: "bg-surface-sunken text-mute",
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function TeamRoster({ engagementId }: { engagementId: string }) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState<string>(DEFAULT_DEPARTMENT);
  const [role, setRole] = useState<MemberRole>("Developer");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<MemberConflict[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMembers(engagementId)
      .then((rows) => {
        if (!cancelled) setMembers(rows);
      })
      .catch(() => {
        // Empty roster renders as the "No one staffed yet" state either way.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [engagementId]);

  function resetForm() {
    setName("");
    setEmail("");
    setDepartment(DEFAULT_DEPARTMENT);
    setRole("Developer");
  }

  async function submit(force: boolean) {
    if (!force) {
      if (!name.trim() || !email.trim()) {
        setError("Name and email are required");
        return;
      }
      if (!EMAIL_RE.test(email.trim())) {
        setError("Enter a valid email address");
        return;
      }
    }
    setError(null);
    setSaving(true);
    try {
      const result = await addMember(engagementId, {
        name: name.trim(),
        email: email.trim(),
        department,
        role,
        force,
      });
      if (result.conflict) {
        setConflict(result.conflicts);
        return;
      }
      setMembers((prev) => [...prev, result.member]);
      setConflict(null);
      resetForm();
      toast(`${result.member.name} added to the project.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(member: ProjectMember) {
    try {
      await removeMember(engagementId, member.id);
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to remove member");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <SectionLabel>Add a team member</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder="Full name"
          />
          <Input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
              setConflict(null);
            }}
            placeholder="name@company.com"
          />
          <Select value={department} onValueChange={setDepartment}>
            <SelectTrigger className="h-9 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEPARTMENTS.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={role} onValueChange={(v) => setRole(v as MemberRole)}>
            <SelectTrigger className="h-9 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {error && <span className="text-[12px] font-medium text-danger">{error}</span>}

        {conflict && (
          <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2.5">
            <div className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
              <p className="text-[12.5px] text-ink">
                <span className="font-semibold">{email}</span> is already staffed on{" "}
                {conflict.map((c, i) => (
                  <span key={c.engagement_id}>
                    {i > 0 && ", "}
                    <span className="font-medium">{c.project_name}</span> ({c.role})
                  </span>
                ))}
                . Add them here too?
              </p>
            </div>
            <div className="flex gap-2 pl-6">
              <GhostButton tone="brand" onClick={() => submit(true)} disabled={saving}>
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Add anyway
              </GhostButton>
              <GhostButton onClick={() => setConflict(null)}>Cancel</GhostButton>
            </div>
          </div>
        )}

        {!conflict && (
          <GhostButton
            tone="brand"
            onClick={() => submit(false)}
            disabled={saving}
            className="w-fit"
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <UserPlus className="size-3.5" />
            )}
            Add to project
          </GhostButton>
        )}
      </div>

      <div>
        <SectionLabel>
          On this project{members.length > 0 ? ` (${members.length})` : ""}
        </SectionLabel>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-mute">
            <Loader2 className="size-4 animate-spin" /> Loading team…
          </div>
        ) : members.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-mute">No one staffed yet.</p>
        ) : (
          <div className="mt-1.5 flex flex-col gap-1.5">
            {members.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-[11px] font-semibold text-ink">
                  {initials(m.name)}
                </span>
                <div className="min-w-0 flex-grow">
                  <div className="truncate text-[13px] font-medium text-ink">{m.name}</div>
                  <div className="truncate text-[11.5px] text-mute">
                    {m.email}
                    {m.department ? ` · ${m.department}` : ""}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] font-semibold ${roleTone[m.role]}`}
                >
                  {m.role}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemove(m)}
                  className="shrink-0 text-mute hover:text-danger"
                  title="Remove from project"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
