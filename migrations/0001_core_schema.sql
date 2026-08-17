-- ============================================================================
-- RiverLine SDD — schema/core.sql
-- FROZEN. Source of truth per docs/riverline-sdd-build-spec.md §3.
-- Agents: never edit. Propose diffs in PR descriptions; orchestrator approves.
-- Authored by orchestrator 2026-08-17 from build spec §3 (verbatim tables),
-- with types/constraints made concrete. Postgres 16 + PostGIS.
-- ============================================================================

create extension if not exists postgis;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
create table jurisdictions (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  nfip_cid            text,                    -- NFIP community ID; null until onboarded
  ordinance_citation  text,                    -- verbatim, human-entered; NEVER generated.
                                               -- null blocks letter generation (A1) explicitly.
  letterhead_config   jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create table users (
  id               uuid primary key default gen_random_uuid(),
  email            text not null unique,
  jurisdiction_id  uuid not null references jurisdictions(id),
  role             text not null check (role in ('admin','assessor','official','viewer')),
  created_at       timestamptz not null default now()
);

create table structures (
  id                     uuid primary key default gen_random_uuid(),
  jurisdiction_id        uuid not null references jurisdictions(id),
  parcel_id              text not null,        -- Hamilton Co PARCELNO (see docs/data-contracts/hamilton-county-parcels.md)
  address                text not null,        -- LOCADDRESS
  geom                   geometry(point, 4326),
  assessor_market_value  numeric(12,2),        -- value used as denominator; see value_source
  improvement_value      numeric(12,2),        -- AVIMPROVE
  value_source           text not null check (value_source in
                           ('assessed_total','assessed_improvement','assessed_adjusted','appraisal','official_override')),
  value_as_of_date       date,
  sfha_zone              text,                 -- NFHL FLD_ZONE
  firm_panel             text,                 -- NFHL panel
  occupancy_type         text check (occupancy_type in ('residential','non_residential')),
  foundation_type        text,
  stories                smallint,
  sq_ft                  integer,              -- sq_ft_res / sq_ft_comm from parcel layer
  year_built             integer,
  prop_class             text,                 -- DLGF code, see docs/data-contracts/dlgf-property-classes.md
  created_at             timestamptz not null default now(),
  unique (jurisdiction_id, parcel_id)
);

create table assessments (
  id                        uuid primary key default gen_random_uuid(),
  structure_id              uuid not null references structures(id),
  jurisdiction_id           uuid not null references jurisdictions(id),
  assessor_user_id          uuid not null references users(id),
  started_at                timestamptz not null default now(),
  completed_at              timestamptz,
  sync_status               text not null default 'synced'
                              check (sync_status in ('queued','syncing','synced','conflict')),
  client_id                 text not null unique,  -- idempotency key from field device
  device_captured_at        timestamptz,
  gps_lat                   double precision,
  gps_lng                   double precision,
  gps_accuracy_m            real,
  water_depth_interior_in   real,
  water_depth_source        text check (water_depth_source in
                              ('observed_line','measured','owner_reported','modeled','unknown')),
  notes                     text
);

create table assessment_elements (
  id                  uuid primary key default gen_random_uuid(),
  assessment_id       uuid not null references assessments(id),
  jurisdiction_id     uuid not null references jurisdictions(id),
  element_code        text not null,           -- SDE 3.0 codes; 12 residential / 7 non-residential
                                               -- per docs/data-contracts/sde-cost-tables.md (FEMA P-784
                                               -- Tables 3-6 / 3-8). NOT the build spec's stale 8-item list.
  damage_pct          smallint not null check (damage_pct between 0 and 100),
  cost_table_version  text not null,
  computed_cost       numeric(12,2),
  unique (assessment_id, element_code)
);

create table photos (
  id               uuid primary key default gen_random_uuid(),
  assessment_id    uuid not null references assessments(id),
  jurisdiction_id  uuid not null references jurisdictions(id),
  storage_key      text not null,
  sha256           char(64) not null,
  captured_at      timestamptz,
  gps_lat          double precision,
  gps_lng          double precision,
  caption          text
);

-- calculations are IMMUTABLE: insert-only, no UPDATE/DELETE (enforced by trigger + RLS).
create table calculations (
  id                  uuid primary key default gen_random_uuid(),
  assessment_id       uuid not null references assessments(id),
  jurisdiction_id     uuid not null references jurisdictions(id),
  cost_table_version  text not null,
  total_repair_cost   numeric(12,2) not null,
  market_value_used   numeric(12,2) not null check (market_value_used > 0),
  value_source        text not null,
  ratio               numeric(6,4) not null,
  threshold_result    text not null check (threshold_result in ('SD','NOT_SD','BORDERLINE')),
  computed_at         timestamptz not null default now(),
  engine_version      text not null
);

create table determinations (
  id                    uuid primary key default gen_random_uuid(),
  structure_id          uuid not null references structures(id),
  jurisdiction_id       uuid not null references jurisdictions(id),
  calculation_id        uuid not null references calculations(id),
  status                text not null default 'draft'
                          check (status in ('draft','adopted','contested','superseded')),
  adopted_by_user_id    uuid references users(id),
  adopted_at            timestamptz,
  letter_id             uuid,                  -- fk added after letters exists
  appeal_deadline_date  date,
  notes                 text,
  created_at            timestamptz not null default now(),
  -- adoption is explicit: adopted requires who and when
  check (status <> 'adopted' or (adopted_by_user_id is not null and adopted_at is not null))
);

create table letters (
  id                uuid primary key default gen_random_uuid(),
  determination_id  uuid not null references determinations(id),
  jurisdiction_id   uuid not null references jurisdictions(id),
  template_version  text not null,
  pdf_storage_key   text not null,
  issued_at         timestamptz,
  delivery_method   text check (delivery_method in ('mail','hand','posted','email'))
);

alter table determinations
  add constraint determinations_letter_fk foreign key (letter_id) references letters(id);

-- append-only
create table audit_log (
  id             bigint generated always as identity primary key,
  actor_user_id  uuid references users(id),
  jurisdiction_id uuid,
  entity_type    text not null,
  entity_id      uuid,
  action         text not null,
  before_json    jsonb,
  after_json     jsonb,
  at             timestamptz not null default now()
);

-- Unit costs: jurisdiction-selected source. NO seeded values anywhere.
-- json_payload rows must each carry source_citation + page; the app refuses a
-- table whose entries lack citations. Test fixtures live only in test/fixtures/
-- and load only into *_test databases, labeled source='TEST-FIXTURE'.
create table cost_tables (
  version          text primary key,
  jurisdiction_id  uuid references jurisdictions(id),  -- null = shared/global table
  source_citation  text not null,
  effective_date   date not null,
  json_payload     jsonb not null,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Immutability & append-only enforcement
-- ---------------------------------------------------------------------------
create or replace function forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception '% is %: %', tg_table_name,
    case when tg_table_name = 'audit_log' then 'append-only' else 'immutable (insert-only)' end,
    tg_op;
end $$;

create trigger calculations_immutable
  before update or delete on calculations
  for each row execute function forbid_mutation();

create trigger audit_log_append_only
  before update or delete on audit_log
  for each row execute function forbid_mutation();

-- determinations: no DELETE ever (status becomes 'superseded')
create or replace function forbid_delete() returns trigger language plpgsql as $$
begin
  raise exception 'determinations are never deleted; set status = superseded';
end $$;

create trigger determinations_no_delete
  before delete on determinations
  for each row execute function forbid_delete();

-- every determination mutation writes audit_log
create or replace function audit_determinations() returns trigger language plpgsql as $$
begin
  insert into audit_log (actor_user_id, jurisdiction_id, entity_type, entity_id, action, before_json, after_json)
  values (
    nullif(current_setting('app.user_id', true), '')::uuid,
    coalesce(new.jurisdiction_id, old.jurisdiction_id),
    'determination',
    coalesce(new.id, old.id),
    tg_op,
    to_jsonb(old),
    to_jsonb(new)
  );
  return new;
end $$;

create trigger determinations_audit
  after insert or update on determinations
  for each row execute function audit_determinations();

-- ---------------------------------------------------------------------------
-- Row-Level Security: jurisdiction isolation on every tenant table.
-- App sets: select set_config('app.jurisdiction_id', <uuid>, true) per request.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['users','structures','assessments','assessment_elements',
                           'photos','calculations','determinations','letters','audit_log']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy %I_tenant on %I using (jurisdiction_id = nullif(current_setting(''app.jurisdiction_id'', true), '''')::uuid)',
      t, t);
  end loop;
end $$;

-- cost_tables: global rows visible to all, jurisdiction rows scoped
alter table cost_tables enable row level security;
alter table cost_tables force row level security;
create policy cost_tables_tenant on cost_tables
  using (jurisdiction_id is null
         or jurisdiction_id = nullif(current_setting('app.jurisdiction_id', true), '')::uuid);

-- jurisdictions: a user sees only their own row
alter table jurisdictions enable row level security;
alter table jurisdictions force row level security;
create policy jurisdictions_self on jurisdictions
  using (id = nullif(current_setting('app.jurisdiction_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
create index on structures (jurisdiction_id, parcel_id);
create index on structures using gist (geom);
create index on assessments (structure_id);
create index on assessments (jurisdiction_id, sync_status);
create index on assessment_elements (assessment_id);
create index on calculations (assessment_id);
create index on determinations (jurisdiction_id, status);
create index on audit_log (entity_type, entity_id);
