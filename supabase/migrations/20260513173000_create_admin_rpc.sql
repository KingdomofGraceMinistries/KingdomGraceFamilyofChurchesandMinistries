-- ============================================================
-- 20260513173000 — create_admin() RPC (SEC-2 finale)
--
-- Bishop-only SECURITY DEFINER function that bcrypt-hashes the
-- supplied PIN and inserts an rf_admins row. Eliminates the
-- last `pin_hash: btoa(pin)` write in kg-pastoral-network.html:
-- the bishop UI now calls /rest/v1/rpc/create_admin instead.
--
-- Internal is_bishop() check rejects non-bishop callers.
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
begin
  if not is_bishop() then
    raise exception 'forbidden: only the bishop may create admins';
  end if;
  if p_email is null or p_email = '' then
    raise exception 'email is required';
  end if;
  if p_pin is null or p_pin !~ '^\d{6}$' then
    raise exception 'pin must be exactly 6 digits';
  end if;
  if exists (select 1 from rf_admins where email = lower(p_email)) then
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
