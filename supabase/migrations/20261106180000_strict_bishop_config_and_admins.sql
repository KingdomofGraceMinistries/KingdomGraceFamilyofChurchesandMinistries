-- ============================================================
-- 2026-11-06 — close two admin-to-bishop escalations.
--
-- is_bishop() is true for role 'bishop' OR 'admin' — it means
-- "dashboard user", and most policies use it correctly that way.
-- Two places used it where only the bishop was meant:
--
-- 1. rf_network_config. config_auth_safe_read exempted is_bishop()
--    from the secret-key filter, and config_bishop_insert/update
--    allowed any is_bishop() write. So any admin could READ
--    bishop_pin_bcrypt, vapid_private_key and resend_api_key, and
--    WRITE bishop_email + bishop_pin_bcrypt — point the bishop
--    login at their own email with a PIN of their choosing and sign
--    in as the bishop. That also voided create_admin's bishop-only
--    rule.
--
-- 2. rf_admins. admins_bishop_all (ALL, is_bishop()) let any admin
--    lock/unlock other admins — the bishop's own row included — and
--    change anyone's permissions, their own too. The Admins tab is
--    bishop-only in the UI; the database did not agree.
--
-- Fix: is_strict_bishop() — role 'bishop' only — for those writes.
-- Credentials become unreadable and unwritable from any client
-- session, bishop included: no screen reads or writes them (checked
-- in kg-pastoral-network.html), and every edge function that needs
-- them uses the service role, which bypasses RLS.
--
-- The role claim is set server-side by kgfcm-pin-login from
-- rf_admins.is_bishop, a column `authenticated` has no grant to
-- write, so a client cannot promote itself to 'bishop'.
--
-- Also adds the bishop-only key dm_notify_admins: whether admins
-- also get push notifications for DMs sent to the bishop.
-- ============================================================

create or replace function public.is_strict_bishop()
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'role') = 'bishop',
    false
  );
$$;

-- ── rf_network_config ──────────────────────────────────────────

-- Credentials: no client session reads them.
drop policy if exists config_auth_safe_read on public.rf_network_config;
create policy config_auth_safe_read on public.rf_network_config
  for select to authenticated
  using (key <> all (array['bishop_pin_bcrypt','bishop_pin_hash','vapid_private_key','resend_api_key']));

-- Writes split three ways:
--   credentials                      → nobody (service role only)
--   bishop identity + bishop prefs   → the bishop only
--   everything else (branding, etc.) → bishop or admin, as before
drop policy if exists config_bishop_insert on public.rf_network_config;
drop policy if exists config_bishop_update on public.rf_network_config;

create policy config_dashboard_insert on public.rf_network_config
  for insert to authenticated
  with check (
    (is_bishop() and key <> all (array['bishop_pin_bcrypt','bishop_pin_hash','vapid_private_key','resend_api_key','bishop_email','dm_notify_admins']))
    or (is_strict_bishop() and key = any (array['bishop_email','dm_notify_admins']))
  );

create policy config_dashboard_update on public.rf_network_config
  for update to authenticated
  using (
    (is_bishop() and key <> all (array['bishop_pin_bcrypt','bishop_pin_hash','vapid_private_key','resend_api_key','bishop_email','dm_notify_admins']))
    or (is_strict_bishop() and key = any (array['bishop_email','dm_notify_admins']))
  )
  with check (
    (is_bishop() and key <> all (array['bishop_pin_bcrypt','bishop_pin_hash','vapid_private_key','resend_api_key','bishop_email','dm_notify_admins']))
    or (is_strict_bishop() and key = any (array['bishop_email','dm_notify_admins']))
  );

-- Default: DMs to the bishop notify the bishop only.
insert into public.rf_network_config (key, value)
values ('dm_notify_admins', 'false')
on conflict (key) do nothing;

-- ── rf_admins ──────────────────────────────────────────────────

-- Admins keep reading the admin list; only the bishop changes it.
drop policy if exists admins_bishop_all on public.rf_admins;

create policy admins_dashboard_read on public.rf_admins
  for select to authenticated
  using (is_bishop());

create policy admins_bishop_insert on public.rf_admins
  for insert to authenticated
  with check (is_strict_bishop());

create policy admins_bishop_update on public.rf_admins
  for update to authenticated
  using (is_strict_bishop())
  with check (is_strict_bishop());

create policy admins_bishop_delete on public.rf_admins
  for delete to authenticated
  using (is_strict_bishop());
