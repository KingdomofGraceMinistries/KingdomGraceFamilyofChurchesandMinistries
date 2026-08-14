-- ============================================================
-- 2026-08-14 — create_admin(): require the bishop specifically.
--
-- is_bishop() is a misnomer. It returns true for
-- app_metadata.role in ('bishop','admin') — effectively "is
-- staff" — and most RLS policies depend on exactly that looser
-- meaning, because admins need the dashboard. So is_bishop()
-- itself must NOT be narrowed; doing so would revoke admin
-- access across a dozen policies.
--
-- create_admin() is the one place where the loose reading is
-- wrong. It is SECURITY DEFINER and reachable by any signed-in
-- user at /rest/v1/rpc/create_admin, and the client sends the
-- caller's session JWT. Under is_bishop(), any admin could mint
-- further admin accounts — a power the UI presents as the
-- bishop's alone (the Admins tab renders only for
-- role === 'bishop').
--
-- That was latent while the bishop was the only row in
-- rf_admins. It became reachable on 2026-08-14, when the first
-- non-bishop admin was created.
--
-- The guard now reads app_metadata.role directly and demands
-- 'bishop'. This matches the check already enforced by the
-- kgfcm-admin-pin-issue edge function: issuing or creating
-- another person's credential is not a delegated power.
--
-- service_role is unaffected in practice — its JWT carries no
-- app_metadata.role, so it failed the old is_bishop() check too,
-- and no edge function calls this RPC (verified: the only caller
-- is addAdmin() in kg-pastoral-network.html).
--
-- Also aligns the duplicate check with the uniqueness that
-- actually exists. idx_rf_admins_email is unique on
-- lower(email), but the guard compared `email = lower(p_email)`,
-- so a legacy mixed-case row would pass the check and then fail
-- on the index with a raw 23505 instead of the intended message.
-- ============================================================

create or replace function public.create_admin(
  p_email text,
  p_name  text,
  p_pin   text
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  new_id uuid;
  caller_role text;
begin
  caller_role := coalesce(
    current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'role',
    ''
  );
  if caller_role <> 'bishop' then
    raise exception 'forbidden: only the bishop may create admins';
  end if;
  if p_email is null or p_email = '' then
    raise exception 'email is required';
  end if;
  if p_pin is null or p_pin !~ '^\d{6}$' then
    raise exception 'pin must be exactly 6 digits';
  end if;
  if exists (select 1 from rf_admins where lower(email) = lower(p_email)) then
    raise exception 'admin with that email already exists';
  end if;

  insert into rf_admins (
    full_name, email, status, is_bishop,
    pin_bcrypt, pin_hash
  ) values (
    p_name,
    lower(p_email),
    'active',
    false,
    extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
    'migrated-to-bcrypt'
  )
  returning id into new_id;

  return new_id;
end;
$fn$;

revoke execute on function public.create_admin(text, text, text) from public, anon;
grant   execute on function public.create_admin(text, text, text) to authenticated, service_role;
