-- Scope Guardian persistence tables — consumed (read-only) by
-- backend/api/scope.py. Populated by a one-off classification script
-- (run_scope_guardian_real.py) that has done its job and been removed from
-- the repo; retrieve it from git history (see the "Add Scope Guardian
-- classification pipeline" commit) if the classification ever needs a rerun.
--
-- This was originally authored under
-- prisma/migrations/20260914000000_add_scope_guardian_tables/migration.sql,
-- which only ever touches Prisma's SQLite database (prisma/schema.prisma,
-- provider "sqlite") — despite being written in Postgres-only syntax
-- (TIMESTAMPTZ, SERIAL, NUMERIC), so it could never actually reach the
-- Postgres database backend/api/scope.py queries. Duplicated here, tracked
-- by backend/scripts/apply_migrations.py like every other real schema
-- change, so it actually gets applied. The prisma/migrations file is left
-- as-is (removing it would need `prisma migrate resolve` gymnastics against
-- Prisma's own tracked history) but should not be treated as live.

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
