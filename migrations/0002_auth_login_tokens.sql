-- ============================================================================
-- 0002_auth_login_tokens.sql
-- M0 auth (magic-link). Adds ONLY infrastructure for issuing/consuming
-- single-use login tokens — schema/core.sql (frozen) is not touched; this is
-- additive, forward-only, and never edits a shipped migration (AGENTS.md
-- rule 5). Not a tenant/business table, so no jurisdiction_id / RLS policy
-- (access is always via the pre-auth "system" db path in
-- src/shared/db, before a jurisdiction context exists — see that module's
-- comments).
-- ============================================================================

create table login_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id),
  token_hash  char(64) not null unique,   -- sha256 hex of the opaque token; never store the raw token
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,       -- 15 minutes from issuance, per specs/constitution.md §6
  used_at     timestamptz                 -- set on first successful verify; single-use enforced in app logic
);

create index on login_tokens (user_id);
