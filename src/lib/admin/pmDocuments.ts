// Client for backend/api/documents.py — the generic PM-document ingestion
// pipeline (Charter, Deliverables Matrix, BRD/PRD, Change Request, Epic
// Brief, Sprint Planning/Review, Retro, Status Report, Risk Log, UAT
// Sign-off, Meeting Notes). SOW keeps its own existing upload flow
// (ProjectDetailPanel's DeliverablesTab) — this is everything else.


import { cachedJson, invalidateCache, relayFetch } from "@/lib/relayApi";
const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

export const PM_DOC_TYPES = [
  "charter", "deliverables_matrix", "requirements", "change_request",
  "epic_brief", "sprint_planning", "sprint_review", "retro", "status_report",
  "risk_log", "uat_signoff", "meeting_notes", "unclassified",
] as const;

export type PmDocType = (typeof PM_DOC_TYPES)[number];

export const DOC_TYPE_LABEL: Record<PmDocType, string> = {
  charter: "Project Charter",
  deliverables_matrix: "Deliverables Matrix",
  requirements: "BRD / PRD",
  change_request: "Change Request",
  epic_brief: "Epic Brief",
  sprint_planning: "Sprint Planning",
  sprint_review: "Sprint Review",
  retro: "Retrospective",
  status_report: "Status Report",
  risk_log: "Risk & Issue Log",
  uat_signoff: "UAT Sign-off",
  meeting_notes: "Meeting Notes",
  unclassified: "Unclassified",
};

export type IngestionStatus = "uploaded" | "classifying" | "needs_review" | "confirmed" | "rejected" | "failed";

export type PmDocumentEntities = {
  people: string[];
  deliverable_ids: string[];
  requirement_ids: string[];
  risk_ids: string[];
  ticket_refs: string[];
  decision_ids: string[];
  cr_refs: string[];
};

export type PmDocumentSection = { section_path: string | null; content: string };

export type PmDocument = {
  id: string;
  engagement_id: string;
  doc_type: PmDocType;
  doc_id: string | null;
  scenario: "client" | "internal" | null;
  doc_version: string | null;
  doc_date: string | null;
  author: string | null;
  doc_status: "draft" | "final" | "superseded" | null;
  recurrence_key: string | null;
  is_latest: boolean;
  source_file_name: string;
  ingestion_status: IngestionStatus;
  classification_confidence: number | null;
  classification_notes: string | null;
  parse_error: string | null;
  entities: PmDocumentEntities;
  pending_sections: PmDocumentSection[];
  uploaded_by: string | null;
  uploaded_at: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  needs_attention?: boolean;
};

export async function listDocuments(
  engagementId: string,
  filters?: { ingestion_status?: string | undefined; doc_type?: string | undefined },
): Promise<PmDocument[]> {
  const params = new URLSearchParams({ engagement_id: engagementId });
  if (filters?.ingestion_status) params.set("ingestion_status", filters.ingestion_status);
  if (filters?.doc_type) params.set("doc_type", filters.doc_type);
  const data = await cachedJson<{ documents: PmDocument[] }>(`${API_URL}/api/admin/documents?${params}`);
  return data.documents;
}

export async function getDocument(id: string): Promise<PmDocument> {
  const res = await relayFetch(`${API_URL}/api/admin/documents/${id}`);
  if (!res.ok) throw new Error(`Failed to load document (${res.status})`);
  return res.json();
}

export async function uploadDocuments(
  engagementId: string,
  files: File[],
  uploadedBy: string,
): Promise<PmDocument[]> {
  const form = new FormData();
  form.append("engagement_id", engagementId);
  form.append("uploaded_by", uploadedBy);
  for (const f of files) form.append("files", f);
  const res = await relayFetch(`${API_URL}/api/admin/documents/upload`, { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Upload failed (${res.status})`);
  }
  const data = await res.json();
  invalidateCache();
  return data.ingested;
}

// `?: X | undefined` (not just `?: X`) so callers can pass an
// explicitly-undefined value under exactOptionalPropertyTypes — this project
// builds with that flag on, which otherwise rejects `{ doc_id: undefined }`.
export type ConfirmEdits = {
  doc_type?: string | undefined;
  doc_id?: string | undefined;
  scenario?: string | undefined;
  doc_version?: string | undefined;
  doc_date?: string | undefined;
  author?: string | undefined;
  doc_status?: string | undefined;
  recurrence_key?: string | undefined;
  pending_sections?: PmDocumentSection[] | undefined;
  confirmed_by?: string | undefined;
};

export async function confirmDocument(id: string, edits: ConfirmEdits): Promise<PmDocument> {
  const res = await relayFetch(`${API_URL}/api/admin/documents/${id}/confirm`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(edits),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Confirm failed (${res.status})`);
  }
  invalidateCache();
  return res.json();
}

export async function rejectDocument(id: string): Promise<void> {
  const res = await relayFetch(`${API_URL}/api/admin/documents/${id}/reject`, { method: "PATCH" });
  if (!res.ok) throw new Error(`Reject failed (${res.status})`);
  invalidateCache();
}

export async function deleteDocument(id: string): Promise<void> {
  await relayFetch(`${API_URL}/api/admin/documents/${id}`, { method: "DELETE" });
  invalidateCache();
}
