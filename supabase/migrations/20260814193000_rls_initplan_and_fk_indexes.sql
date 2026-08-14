-- ============================================================
-- 2026-08-14 — RLS init-plan hoisting + covering FK indexes.
--
-- Two findings from the Supabase database linter, neither
-- affecting who can see what. Both are purely about how much
-- work Postgres repeats per row.
--
-- 1. auth_rls_initplan (lint 0003) on seven policies
--
-- `auth.uid()` written bare in a policy is re-evaluated for
-- every candidate row. Wrapping it as `(select auth.uid())`
-- turns it into an InitPlan: evaluated once per statement, and
-- the result reused. auth.uid() is STABLE and takes no
-- arguments, so a single evaluation per statement is exactly
-- equivalent — this changes cost, never the outcome.
--
-- Applied with ALTER POLICY rather than DROP + CREATE. A drop
-- leaves an instant where the table has no policy for that
-- command, and on tables holding pastors' contact details and
-- push endpoints that window is not worth opening for a
-- performance tweak. ALTER swaps the expression in place.
--
-- push_self_select also has is_bishop() hoisted. The linter
-- cannot see inside it — it only matches auth.* and
-- current_setting() textually — but is_bishop() reads
-- request.jwt.claims via current_setting() and is likewise
-- STABLE, so leaving it bare would have half-fixed the one
-- policy this migration exists to fix. Other policies calling
-- is_bishop() are deliberately untouched here; they are a
-- separate sweep, not a drive-by.
--
-- 2. unindexed_foreign_keys (lint 0001) on three tables
--
-- rf_prayer_requests, rf_team_responses and rf_wins each have a
-- pastor_id foreign key with no covering index. Every one of
-- these is read filtered by pastor on the bishop's pastor
-- drill-down, and each also forces a sequential scan whenever a
-- referenced rf_pastors row is updated or deleted, because
-- Postgres must confirm no child rows reference it.
--
-- rf_checkins already had idx_checkins_pastor; these three were
-- simply missed. Naming follows that precedent.
--
-- Written IF NOT EXISTS and idempotent, so re-running is safe.
-- ============================================================

-- ── 1. Hoist auth.uid() into an InitPlan ───────────────────

alter policy admins_self_read on public.rf_admins
  using (auth_user_id = (select auth.uid()));

alter policy pastors_self_read on public.rf_pastors
  using (auth_user_id = (select auth.uid()));

alter policy pastors_self_update on public.rf_pastors
  using      (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid()));

alter policy push_self_select on public.rf_push_subscriptions
  using ((user_id = ((select auth.uid()))::text) or (select is_bishop()));

alter policy push_self_insert on public.rf_push_subscriptions
  with check (user_id = ((select auth.uid()))::text);

alter policy push_self_update on public.rf_push_subscriptions
  using      (user_id = ((select auth.uid()))::text)
  with check (user_id = ((select auth.uid()))::text);

alter policy push_self_delete on public.rf_push_subscriptions
  using (user_id = ((select auth.uid()))::text);

-- ── 2. Covering indexes for the pastor_id foreign keys ─────

create index if not exists idx_prayer_pastor
  on public.rf_prayer_requests (pastor_id);

create index if not exists idx_team_pastor
  on public.rf_team_responses (pastor_id);

create index if not exists idx_wins_pastor
  on public.rf_wins (pastor_id);
