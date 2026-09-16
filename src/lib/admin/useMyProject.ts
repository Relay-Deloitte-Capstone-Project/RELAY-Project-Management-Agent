// Resolves the logged-in developer/manager's own project scope from
// public.project_staffing (backend/api/me.py) instead of every page hitting
// one hardcoded ENGAGEMENT_ID constant regardless of who's logged in. That
// constant used to mean every developer saw the same project's Jira/GitHub
// tickets and SOW-derived answers no matter which engagement they were
// actually staffed on — this is what makes "Damon only sees Patient Intake
// Portal, Akshar only sees Acme" actually true instead of just true in the
// UI's copy.
import { useEffect, useState } from "react";

const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

export type MyProject = {
  engagement_id: string;
  project_code: string | null;
  name: string;
  client_name: string;
  role: string;
};

// A person can legitimately be staffed on more than one project (the
// double-staffing flag warns but doesn't block it) — this always resolves
// to the first one they were assigned to, which is what every current
// single-project-per-person scenario needs. A project switcher for people
// on multiple engagements is the natural next step, not built here.
export function useMyProject(email: string): {
  project: MyProject | null;
  loading: boolean;
  error: string | null;
} {
  const [project, setProject] = useState<MyProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${API_URL}/api/me/projects?email=${encodeURIComponent(email)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load your project (${res.status})`);
        return res.json();
      })
      .then((rows: MyProject[]) => {
        if (!cancelled) setProject(rows[0] ?? null);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load your project");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [email]);

  return { project, loading, error };
}
