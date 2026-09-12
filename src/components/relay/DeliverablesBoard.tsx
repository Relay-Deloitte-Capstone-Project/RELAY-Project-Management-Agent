import { ChevronDown, ChevronRight, FileText, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { PageSection, Panel } from "@/components/relay/primitives";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Shared by both the Admin and Manager "Deliverables" tabs — one component,
// two thin route wrappers, so the two roles never drift out of sync on what
// this view shows.
const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

// The project selector here reads directly from public.projects (the real
// backend), not the client-side mock project list the rest of the admin UI
// still uses. Mock project identity (id, engagementId) lives only in
// browser memory and resets on every reload, so a project created by the
// setup wizard minutes ago would silently vanish from a mock-driven
// selector the moment the page refreshed — the wizard had saved the SOW
// correctly, but nothing durable pointed back at it. The database itself
// is the only thing that reliably knows which projects and SOWs exist.
type BackendProject = {
  engagement_id: string;
  name: string;
};

type SowDeliverable = {
  id: string;
  sequence: number;
  name: string;
  acceptance_criteria: string | null;
  source_page: number | null;
  is_edited: boolean;
};

type SowDocument = {
  id: string;
  file_name: string;
  status: "uploaded" | "parsing" | "parsed" | "failed";
  parse_error: string | null;
  scope_exclusions: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  parsed_at: string | null;
  deliverables: SowDeliverable[];
};

const statusStyle: Record<SowDocument["status"], string> = {
  parsed: "bg-success-soft text-success",
  parsing: "bg-warning-soft text-warning",
  uploaded: "bg-surface-sunken text-mute",
  failed: "bg-danger-soft text-danger",
};

const statusLabel: Record<SowDocument["status"], string> = {
  parsed: "Parsed",
  parsing: "Parsing…",
  uploaded: "Uploaded",
  failed: "Parse failed",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function DocumentCard({ doc }: { doc: SowDocument }) {
  const [expanded, setExpanded] = useState(doc.status === "parsed");

  return (
    <div className="border-b border-border py-3.5 last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <div className="flex items-start gap-2.5">
          {expanded ? (
            <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-mute" />
          ) : (
            <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-mute" />
          )}
          <FileText className="mt-0.5 size-3.5 shrink-0 text-mute" />
          <div>
            <div className="text-[13px] font-semibold text-ink">{doc.file_name}</div>
            <div className="text-[11.5px] text-mute">
              Uploaded {formatDate(doc.uploaded_at)}
              {doc.uploaded_by ? ` by ${doc.uploaded_by}` : ""}
            </div>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] font-semibold ${statusStyle[doc.status]}`}
        >
          {statusLabel[doc.status]}
        </span>
      </button>

      {expanded && (
        <div className="mt-3 flex flex-col gap-2 pl-9">
          {doc.status === "failed" && (
            <p className="flex items-start gap-1.5 text-[12px] text-danger">
              <X className="mt-0.5 size-3 shrink-0" />
              {doc.parse_error || "Parsing failed for an unknown reason"}
            </p>
          )}

          {doc.deliverables.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {doc.deliverables.map((d) => (
                <div key={d.id} className="rounded-lg bg-surface-sunken px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-mute">D{d.sequence}</span>
                    <span className="text-[13px] font-medium text-ink">{d.name}</span>
                    {d.is_edited && (
                      <span className="rounded-sm bg-brand-soft px-1 py-0.5 text-[10px] font-semibold text-brand">
                        Edited
                      </span>
                    )}
                    {d.source_page != null && (
                      <span className="ml-auto shrink-0 text-[11px] text-mute">
                        p.{d.source_page}
                      </span>
                    )}
                  </div>
                  {d.acceptance_criteria && (
                    <p className="mt-1 text-[12px] text-mute">{d.acceptance_criteria}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            doc.status === "parsed" && (
              <p className="text-[12px] text-mute">
                No deliverables were extracted from this document.
              </p>
            )
          )}

          {doc.scope_exclusions && (
            <div className="mt-1 rounded-lg border border-border px-3 py-2">
              <div className="text-[11px] font-semibold tracking-wide text-mute uppercase">
                Scope exclusions
              </div>
              <p className="mt-1 text-[12px] text-mute">{doc.scope_exclusions}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DeliverablesBoard() {
  const [projects, setProjects] = useState<BackendProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [engagementId, setEngagementId] = useState<string>("");
  const [docs, setDocs] = useState<SowDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/admin/projects`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load projects (${res.status})`);
        return res.json();
      })
      .then((data: BackendProject[]) => {
        if (cancelled) return;
        setProjects(data);
        const first = data[0];
        if (first) setEngagementId(first.engagement_id);
      })
      .catch((err) => {
        if (!cancelled)
          setProjectsError(err instanceof Error ? err.message : "Failed to load projects");
      })
      .finally(() => {
        if (!cancelled) setProjectsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!engagementId) {
      setDocs([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${API_URL}/api/admin/sow?engagement_id=${engagementId}&include_deliverables=true`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        return res.json();
      })
      .then((data: SowDocument[]) => {
        if (!cancelled) setDocs(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [engagementId]);

  const totalDeliverables = docs.reduce((sum, d) => sum + d.deliverables.length, 0);

  return (
    <PageSection
      label="Deliverables"
      subtitle="Every deliverable extracted from this project's uploaded SOWs, grouped by the document it came from."
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <Select
          value={engagementId}
          onValueChange={setEngagementId}
          disabled={projects.length === 0}
        >
          <SelectTrigger className="h-8 w-56 text-[13px]">
            <SelectValue placeholder={projectsLoading ? "Loading projects…" : "No projects yet"} />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.engagement_id} value={p.engagement_id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {docs.length > 0 && (
          <span className="text-[12px] font-medium text-mute">
            {totalDeliverables} deliverable{totalDeliverables === 1 ? "" : "s"} · {docs.length}{" "}
            document{docs.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <Panel>
        {projectsError ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-danger">
            <X className="size-4" /> {projectsError}
          </div>
        ) : projectsLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-mute">
            <Loader2 className="size-4 animate-spin" /> Loading projects…
          </div>
        ) : !engagementId ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <FileText className="size-6 text-mute" />
            <p className="text-[13px] text-mute">
              No projects yet — create one from Project setup first.
            </p>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-mute">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : error ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-danger">
            <X className="size-4" /> {error}
          </div>
        ) : docs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <FileText className="size-6 text-mute" />
            <p className="text-[13px] text-mute">No SOW documents uploaded for this project yet.</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {docs.map((doc) => (
              <DocumentCard key={doc.id} doc={doc} />
            ))}
          </div>
        )}
      </Panel>
    </PageSection>
  );
}
