-- ============================================================
-- 2026-11-18 — invites are minted on the server and stored hashed.
--
-- Until now the inviting browser generated the token
-- (crypto.randomUUID) and INSERTed it into rf_invites in plaintext.
-- RLS limited that to the bishop/admins, but:
--   * any staff session could read every unused token — a working
--     sign-up credential — straight out of the table;
--   * a failed insert was never audited (the client's audit() call
--     came after the insert), so a broken "Create Invite" left no
--     trace. rf_invites has never held a row.
--
-- Now:
--   * create_invite(p_name) — SECURITY DEFINER, bishop/admin only —
--     generates 32 random bytes server-side, stores only the SHA-256
--     hex of the token, audits INVITE_CREATED server-side (actor from
--     the verified JWT), and returns the plaintext token exactly once
--     so the inviter can share the link.
--   * kgfcm-pin-register hashes the token it receives and claims the
--     invite by token_hash (same SHA-256 hex as _shared/audit.ts
--     hashIdentifier).
--   * `authenticated` loses INSERT/UPDATE/DELETE on rf_invites and can
--     SELECT only the columns the Invites list shows — never the hash.
-- ============================================================

-- The plaintext column can only be dropped while there is nothing in it.
do $$
begin
  if exists (select 1 from public.rf_invites) then
    raise exception 'rf_invites is not empty — migrate existing tokens before dropping the plaintext column';
  end if;
end $$;

alter table public.rf_invites drop column token;          -- drops its unique constraint and idx_invites_token
alter table public.rf_invites add column token_hash text not null;
alter table public.rf_invites add constraint rf_invites_token_hash_key unique (token_hash);
alter table public.rf_invites add column created_by uuid;

-- Privileges: read-only for staff, and never the hash. All writes go
-- through create_invite() or the register edge function (service role).
revoke all on public.rf_invites from anon, authenticated;
grant select (id, invited_name, accepted_at, created_at)
  on public.rf_invites to authenticated;

drop policy if exists invites_bishop on public.rf_invites;
create policy invites_staff_read on public.rf_invites
  for select to authenticated
  using (is_bishop());

create or replace function public.create_invite(p_name text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name  text := btrim(coalesce(p_name, ''));
  v_role  text := coalesce(current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'role', '');
  v_token text;
  v_id    uuid;
begin
  if not is_bishop() then
    raise exception 'forbidden: only the bishop or an admin may create invites';
  end if;
  if v_name = '' then
    raise exception 'name is required';
  end if;
  if length(v_name) > 80 then
    raise exception 'name must be 80 characters or fewer';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.rf_invites (email, invited_name, token_hash, created_by)
  values ('', v_name, encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid())
  returning id into v_id;

  insert into public.rf_audit_log (event_type, actor_id, actor_role, target_table, target_id, metadata)
  values ('INVITE_CREATED', auth.uid()::text, v_role, 'rf_invites', v_id::text, '{}'::jsonb);

  return v_token;
end;
$$;

revoke all on function public.create_invite(text) from public, anon;
grant execute on function public.create_invite(text) to authenticated;

-- Post-migration assertions -----------------------------------------
do $$
begin
  if has_column_privilege('authenticated', 'public.rf_invites', 'token_hash', 'SELECT') then
    raise exception 'token_hash is readable by authenticated';
  end if;
  if has_table_privilege('authenticated', 'public.rf_invites', 'INSERT')
     or has_table_privilege('authenticated', 'public.rf_invites', 'UPDATE')
     or has_table_privilege('authenticated', 'public.rf_invites', 'DELETE') then
    raise exception 'authenticated can still write rf_invites directly';
  end if;
  if has_function_privilege('anon', 'public.create_invite(text)', 'EXECUTE') then
    raise exception 'anon can execute create_invite';
  end if;
end $$;
