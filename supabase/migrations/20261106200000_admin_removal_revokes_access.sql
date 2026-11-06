-- ============================================================
-- 2026-11-06 — removing or locking an admin actually ends access.
--
-- Two gaps, found while making the bishop's "Remove admin" work:
--
-- 1. `authenticated` had no DELETE privilege on rf_admins, so the
--    button never removed anything — and the client's delete helper
--    ignored the error, so it looked like it had.
--
-- 2. Neither removing nor locking an admin touched their Supabase
--    auth user. A signed-in admin kept a refresh token whose JWT
--    still carried app_metadata.role = 'admin', so is_bishop() kept
--    returning true and the dashboard stayed open to them
--    indefinitely. That includes the vendor support admin, whose
--    deactivation is on the handover checklist.
--
-- Fix: grant DELETE (still bishop-only by policy, and never the
-- bishop's own row — his login reads it), and a trigger that, when
-- an admin row is deleted or leaves status 'active', sets that auth
-- user's role claim to 'revoked' and deletes their sessions (refresh
-- tokens cascade). Access tokens already issued expire on their own
-- (≤ 1 hour) and cannot be renewed. Unlocking needs nothing extra:
-- kgfcm-pin-login rewrites the role claim on the next sign-in.
--
-- The trigger is SECURITY DEFINER because only the owner may write
-- the auth schema; it acts solely on the auth user linked to the row
-- being changed, and RLS has already decided whether the caller may
-- change that row (strict bishop only).
-- ============================================================

grant delete on public.rf_admins to authenticated;

drop policy if exists admins_bishop_delete on public.rf_admins;
create policy admins_bishop_delete on public.rf_admins
  for delete to authenticated
  using (is_strict_bishop() and coalesce(is_bishop, false) = false);

create or replace function public.revoke_admin_access()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  target uuid := old.auth_user_id;
begin
  if target is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE'
     or (tg_op = 'UPDATE' and coalesce(old.status, 'active') = 'active' and coalesce(new.status, 'active') <> 'active') then
    update auth.users
       set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'revoked')
     where id = target;
    delete from auth.sessions where user_id = target;
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.revoke_admin_access() from public, anon, authenticated;

drop trigger if exists rf_admins_revoke_access on public.rf_admins;
create trigger rf_admins_revoke_access
  after update of status or delete on public.rf_admins
  for each row execute function public.revoke_admin_access();
