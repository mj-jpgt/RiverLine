-- ============================================================================
-- 0005_contractor_estimates.sql
-- A4 (docs/riverline-sdd-build-spec.md §8, "OCR: Scope and Failure Modes"):
-- contractor repair-estimate intake, OCR-assisted, human-confirmed. ADDITIVE
-- migration — schema/core.sql itself stays FROZEN and untouched (AGENTS.md
-- rule 1), following the exact precedent 0002/0003/0004 already set (new
-- tables/columns added outside core.sql, never editing a shipped migration,
-- AGENTS.md rule 5).
--
-- Table shape is the literal one specified for this task (T-W2), reproduced
-- verbatim below — not invented against the frozen schema, since
-- schema/core.sql itself has no `estimates` table at all (A4 postdates the
-- MVP core, per build spec §1.1 "MVP = M0-M4 + A1 + A2 + A3. Do not start
-- any A4-A8 work until an official has used M0-A3 on a real structure" — the
-- orchestrator has explicitly greenlit this add-on task regardless).
--
-- OCR never commits a value on its own (spec §8, closing framing: "Treat OCR
-- as an assist that pre-fills fields a human confirms — never as a data
-- source that commits values"). This table shape encodes that directly:
-- `extracted_json` is the raw, unconfirmed OCR output; `confirmed_total` /
-- `confirmed_line_items` / `scope_reviewed` / `confirmed_by_user_id` /
-- `confirmed_at` are a SEPARATE set of columns that stay NULL / false until
-- a human explicitly confirms (src/modules/a4-estimates/actions.ts
-- `confirmEstimate`, the only code path that ever sets them). A row with
-- extracted_json populated but confirmed_at still null is an honest
-- "OCR ran, nobody has confirmed it yet" state — never conflated with a
-- confirmed record anywhere in this module's queries or UI.
--
-- Version chain (spec §8.3, "Multi-page and revision confusion... one
-- estimate = one document record with explicit version; never merge numbers
-- across uploads"): a re-upload for the same assessment always INSERTS a
-- new row with `version = previous_version + 1` and
-- `supersedes_estimate_id` pointing at the row it replaces — never an
-- UPDATE of the prior row's document/extracted/confirmed fields. Prior
-- versions remain queryable forever (same append-only spirit as
-- `calculations`/`determinations`, though this table has no DB-level
-- immutability trigger — the app layer, not a trigger, is the enforcement
-- point here, since `confirmed_*` legitimately gets written once, after the
-- row already exists, by the confirmation step).
-- ============================================================================

create table estimates (
  id                      uuid primary key default gen_random_uuid(),
  assessment_id           uuid not null references assessments(id),
  jurisdiction_id         uuid not null references jurisdictions(id),
  storage_key             text not null,
  sha256                  char(64) not null,
  original_filename       text,
  version                 int not null default 1,
  supersedes_estimate_id  uuid references estimates(id),
  ocr_engine              text,
  ocr_engine_version      text,
  extracted_json          jsonb,
  confirmed_total         numeric(12,2),
  confirmed_line_items    jsonb,
  scope_reviewed          boolean not null default false,
  confirmed_by_user_id    uuid references users(id),
  confirmed_at            timestamptz,
  notes                   text,
  created_at              timestamptz not null default now()
);

-- Row-Level Security: identical in shape to every tenant table's policy in
-- schema/core.sql's own `do $$ ... foreach t in array [...]` block (see that
-- file's "Row-Level Security" section) — this table just isn't in that
-- array because it postdates the frozen file, so the same two statements +
-- policy are reproduced by hand here.
alter table estimates enable row level security;
alter table estimates force row level security;
create policy estimates_tenant on estimates
  using (jurisdiction_id = nullif(current_setting('app.jurisdiction_id', true), '')::uuid);

-- Same index shape as photos/calculations (`create index on <table>
-- (assessment_id)` in schema/core.sql) plus the jurisdiction+status lookups
-- the module's queries actually run (list-by-assessment, version-chain
-- walk).
create index on estimates (assessment_id);
create index on estimates (jurisdiction_id);
create index on estimates (supersedes_estimate_id);

-- migrations/0003_app_role.sql's `grant ... on all tables in schema public`
-- was a SNAPSHOT at the time it ran — it does NOT retroactively cover a
-- table created later, which this migration discovered the hard way (a
-- real "permission denied for table estimates" from `riverline_app`,
-- caught by this task's own integration tests, not invented/assumed).
-- Every table created after 0003 needs its own explicit grant; this is
-- that grant for `estimates`.
grant select, insert, update, delete on estimates to riverline_app;
