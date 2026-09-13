-- Scope Guardian persistence tables.
-- These tables are populated by the Scope Guardian Python pipeline
-- and consumed by backend/api/scope.py.

CREATE TABLE IF NOT EXISTS "sow_ticket_classifications" (
    "ticket_id" TEXT PRIMARY KEY,
    "ticket_summary" TEXT,
    "epic_key" TEXT NOT NULL,
    "deliverable_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "clause" TEXT,
    "reason" TEXT,
    "computed_at" TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "sow_scope_alerts" (
    "id" SERIAL PRIMARY KEY,
    "ticket_id" TEXT NOT NULL,
    "ticket_summary" TEXT,
    "deliverable_key" TEXT,
    "status" TEXT,
    "clause" TEXT,
    "reason" TEXT,
    "computed_at" TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "sow_deliverable_compliance" (
    "deliverable_key" TEXT PRIMARY KEY,
    "deliverable_title" TEXT,
    "total_tickets" INT,
    "in_scope_count" INT,
    "compliance_percent" NUMERIC,
    "computed_at" TIMESTAMPTZ DEFAULT NOW()
);
