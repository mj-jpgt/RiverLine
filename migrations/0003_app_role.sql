-- ============================================================================
-- 0003_app_role.sql
-- Creates the non-superuser Postgres role the application's db client
-- (src/shared/db) switches into via `SET LOCAL ROLE` for every tenant-scoped
-- request. This is what makes Row-Level Security in schema/core.sql actually
-- enforced: the local dev/test Postgres user (DATABASE_URL, e.g. `riverline`)
-- is a superuser, and superusers ALWAYS bypass RLS regardless of `FORCE ROW
-- LEVEL SECURITY` — that is a hard Postgres rule, not a config knob. Without
-- a distinct non-superuser role to switch into, RLS would silently never
-- apply to any app query. See src/shared/db/client.ts for the SET LOCAL ROLE
-- usage and docs/journal/2026-08-17-c1-auth-db.md for the reasoning.
--
-- NOLOGIN: nothing connects to Postgres directly as this role. The app's one
-- pooled connection (as the superuser) uses SET LOCAL ROLE to assume it for
-- the duration of a transaction; superusers may SET ROLE to any role without
-- membership grants or a password.
-- ============================================================================

do $$
begin
  if not exists (select from pg_roles where rolname = 'riverline_app') then
    create role riverline_app nologin;
  end if;
end $$;

grant usage on schema public to riverline_app;
grant select, insert, update, delete on all tables in schema public to riverline_app;
grant usage, select on all sequences in schema public to riverline_app;
