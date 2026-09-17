// Real public.projects data (backend/api/admin_projects.py) — the source of
// truth for the All Projects list and the setup wizard's resume flow.
//
// Previously both pages read from the client-side mockProjects array, which
// lives only in browser memory: closing the app (or even just refreshing)
// lost track of which real engagement_id a project was, so "resume where
// you left off" couldn't actually work. This reads the database instead,
// so setup progress survives a closed browser exactly like it should.
import {
  SETUP_STEPS,
  completedStepCount,
  firstIncompleteStep,
  type SetupProgress,
} from "@/lib/admin/mockProjects";
import { cachedJson, invalidateCache, relayFetch } from "@/lib/relayApi";

const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

export type BackendProject = {
  engagement_id: string;
  project_code?: string | null;
  name: string;
  client_name: string;
  status: "setup" | "active" | "archived";
  start_date: string | null;
  end_date: string | null;
  created_by: string | null;
  created_at: string;
  jira_base_url: string | null;
  jira_project_key: string | null;
  github_repo_url: string | null;
  github_branch: string | null;
  retention_days: number | null;
  dpa_reference: string | null;
  // Only present on the list endpoint (GET /api/admin/projects) — a
  // cheap subquery count, not a full roster fetch.
  member_count?: number;
};

export type MemberRole = "Manager" | "Developer" | "QA" | "Designer" | "Observer";

export type ProjectMember = {
  id: string;
  engagement_id: string;
  name: string;
  email: string;
  department: string | null;
  role: MemberRole;
  assigned_at: string;
};

export type MemberConflict = {
  engagement_id: string;
  project_name: string;
  project_code: string | null;
  role: MemberRole;
};

// Derived purely from what's actually saved in the database — no separate
// "setup_progress" column to keep in sync. A step counts as done when the
// data it's responsible for exists:
//   details -> the project row itself exists (always true here)
//   jira    -> a project_jira_links row was saved
//   github  -> a project_github_links row was saved
//   sow     -> project_governance was saved (the SOW step's Next button
//              always saves retention/DPA, whether or not a PDF was
//              uploaded — "Skip for now" still reaches this)
//   team    -> the wizard's Finish button flips status to 'active'
export function deriveSetupProgress(p: BackendProject): SetupProgress {
  return {
    details: true,
    jira: Boolean(p.jira_project_key),
    github: Boolean(p.github_repo_url),
    sow: p.retention_days !== null || Boolean(p.dpa_reference),
    team: p.status === "active",
  };
}

export async function fetchProjects(): Promise<BackendProject[]> {
  return cachedJson<BackendProject[]>(`${API_URL}/api/admin/projects`);
}

export async function fetchProject(engagementId: string): Promise<BackendProject> {
  return cachedJson<BackendProject>(`${API_URL}/api/admin/projects/${engagementId}`);
}

export async function fetchMembers(engagementId: string): Promise<ProjectMember[]> {
  return cachedJson<ProjectMember[]>(`${API_URL}/api/admin/projects/${engagementId}/staffing`);
}

// Returns either { conflict: false, member } once the member is actually
// saved, or { conflict: true, conflicts } if the email is already staffed
// on another non-archived project and `force` wasn't set — the caller
// decides whether to show that as a blocking warning and re-call with
// force: true.
export async function addMember(
  engagementId: string,
  fields: { name: string; email: string; department: string; role: MemberRole; force?: boolean },
): Promise<
  { conflict: true; conflicts: MemberConflict[] } | { conflict: false; member: ProjectMember }
> {
  const res = await relayFetch(`${API_URL}/api/admin/projects/${engagementId}/staffing`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to add member (${res.status})`);
  }
  invalidateCache(`${API_URL}/api/admin/projects/${engagementId}/staffing`);
  invalidateCache(`${API_URL}/api/admin/projects`);
  return res.json();
}

export async function removeMember(engagementId: string, memberId: string): Promise<void> {
  const res = await relayFetch(`${API_URL}/api/admin/projects/${engagementId}/staffing/${memberId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to remove member (${res.status})`);
  invalidateCache(`${API_URL}/api/admin/projects/${engagementId}/staffing`);
  invalidateCache(`${API_URL}/api/admin/projects`);
}

export { SETUP_STEPS, completedStepCount, firstIncompleteStep };
export type { SetupProgress };
