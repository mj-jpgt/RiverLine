-- ============================================================================
-- 0007_users_deactivated.sql
-- G3 (team user management): ADDITIVE migration, following the exact
-- 0002/0003/0004/0005/0006 precedent of extending outside schema/core.sql,
-- which stays FROZEN and untouched (AGENTS.md rule 1).
--
-- Why this is needed: the top emergency-readiness gap is that users can
-- only be created by a seed script, and there is no way for an admin to
-- take a former staff member's access away. schema/core.sql's `users`
-- table (frozen) has no active/inactive flag. Nullable, no backfill: every
-- existing users row was created active, so deactivated_at is simply null
-- for all of them — a null value IS "active," by construction, everywhere
-- this column is read (src/core/admin/queries.ts, src/core/auth/
-- magic-link.ts, src/core/auth/role-guard.ts's requireActiveRole).
--
-- Deactivation is a soft flag, not a delete: schema/core.sql's users table
-- is referenced by assessments.assessor_user_id, determinations.
-- adopted_by_user_id, audit_log.actor_user_id, login_tokens.user_id — a
-- deactivated user's historical rows (assessments they captured,
-- determinations they adopted) must stay intact and attributable. Only
-- future sign-in and future role-gated access are blocked.
-- ============================================================================

alter table users add column deactivated_at timestamptz;

-- Every readiness-panel / user-list query filters/counts by
-- (jurisdiction_id, deactivated_at) — see src/core/admin/queries.ts
-- listUsers / getTeamSummary.
create index on users (jurisdiction_id, deactivated_at);
