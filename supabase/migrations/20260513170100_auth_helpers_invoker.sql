-- ============================================================
-- 20260513170100 — Switch RLS helper functions to SECURITY INVOKER.
--
-- is_bishop() reads only the caller's JWT claims.
-- pastor_id_for_current_user() needs only the SELECT grants that
-- authenticated already has on rf_pastors.
-- Running them as SECURITY DEFINER was unnecessary privilege escalation
-- and tripped the "anon can execute SECURITY DEFINER" advisor warnings.
--
-- verify_pin / hash_pin remain SECURITY DEFINER + service_role-only
-- because they intentionally bypass the column-level revoke of pin_bcrypt.
-- ============================================================

create or replace function public.is_bishop() returns boolean
language sql stable security invoker
set search_path = public, pg_temp
as $fn$
  select coalesce(
    (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'role') in ('bishop','admin'),
    false
  );
$fn$;

create or replace function public.pastor_id_for_current_user() returns uuid
language sql stable security invoker
set search_path = public, pg_temp
as $fn$
  select id from rf_pastors where auth_user_id = auth.uid() limit 1;
$fn$;
