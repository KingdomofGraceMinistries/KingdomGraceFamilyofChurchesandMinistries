-- ============================================================
-- 2026-11-18 — pastor reads/saves work; admins get a profile.
--
-- Reported as "the admin cannot save her profile". Three causes:
--
-- 1. The client selects credential_doc_path / credential_doc_uploaded_at
--    in every rf_pastors read (PASTOR_COLS), but 20260514165925 granted
--    those two columns UPDATE only. Postgres refuses a whole query that
--    names an unreadable column, so every signed-in pastor read failed
--    with 42501 — the bishop overview, pastor view and a pastor's own
--    profile load. The files stay protected by the `credentials` bucket
--    policies; the path is only a pointer.
--
-- 2. (Client fix, same commit.) sbU() asked PostgREST for the updated
--    row back, i.e. RETURNING every column — including pin_bcrypt on
--    rf_pastors and rf_admins, which `authenticated` cannot read. Every
--    profile save, credential link, check-in stamp and admin lock/unlock
--    failed. The audit log has never once recorded PROFILE_UPDATED or
--    CREDENTIAL_DOC_UPLOADED.
--
-- 3. Admins (and the bishop, whose row is also in rf_admins) had no
--    profile storage at all. The "Me" screen wrote their form into
--    rf_pastors under an rf_admins id. They now get the same profile
--    fields on rf_admins, written through update_my_admin_profile().
--
-- Why an RPC rather than a self-update policy: column grants are
-- per-role, not per-row. `authenticated` already holds UPDATE on
-- rf_admins.status and .permissions for the bishop's lock/unlock, so
-- any self-update policy would also let an admin unlock or re-permission
-- themselves. The function writes only profile columns, only on the
-- caller's own active row.
-- ============================================================

-- 1. Pastor reads ------------------------------------------------------
grant select (credential_doc_path, credential_doc_uploaded_at)
  on public.rf_pastors to authenticated;

-- 3. Admin profile fields — same names and types as rf_pastors ---------
alter table public.rf_admins
  add column if not exists avatar_url                 text,
  add column if not exists church_name                text,
  add column if not exists city                       text,
  add column if not exists years_in_ministry          integer default 0,
  add column if not exists bio                        text,
  add column if not exists prayer_focus               text,
  add column if not exists believing_for              text,
  add column if not exists spiritual_gifts            text[]  default '{}'::text[],
  add column if not exists credential_type            text,
  add column if not exists ordination_date            date,
  add column if not exists ordained_by                text,
  add column if not exists covering_under             text,
  add column if not exists credential_doc_path        text,
  add column if not exists credential_doc_uploaded_at timestamptz;

-- Readable under the existing rf_admins policies: the row's owner
-- (admins_self_read) and the bishop/admins (admins_dashboard_read).
-- Pastors still cannot read rf_admins at all.
grant select (avatar_url, church_name, city, years_in_ministry, bio,
              prayer_focus, believing_for, spiritual_gifts,
              credential_type, ordination_date, ordained_by,
              covering_under, credential_doc_path,
              credential_doc_uploaded_at)
  on public.rf_admins to authenticated;

create or replace function public.update_my_admin_profile(p jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid  uuid := auth.uid();
  n    int;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'profile must be a JSON object';
  end if;
  if p ? 'full_name' and btrim(coalesce(p->>'full_name', '')) = '' then
    raise exception 'name is required';
  end if;
  -- A credential pointer may only name a file in the caller's own
  -- folder, matching the path the client uploads to.
  if p ? 'credential_doc_path'
     and p->>'credential_doc_path' is not null
     and left(p->>'credential_doc_path', length(uid::text) + 1) <> uid::text || '/' then
    raise exception 'credential path must be in your own folder';
  end if;

  update public.rf_admins set
    full_name                  = case when p ? 'full_name'         then btrim(p->>'full_name')                    else full_name end,
    avatar_url                 = case when p ? 'avatar_url'        then nullif(p->>'avatar_url', '')              else avatar_url end,
    church_name                = case when p ? 'church_name'       then nullif(btrim(p->>'church_name'), '')      else church_name end,
    city                       = case when p ? 'city'              then nullif(btrim(p->>'city'), '')             else city end,
    years_in_ministry          = case when p ? 'years_in_ministry' then coalesce((p->>'years_in_ministry')::int, 0) else years_in_ministry end,
    bio                        = case when p ? 'bio'               then nullif(btrim(p->>'bio'), '')              else bio end,
    prayer_focus               = case when p ? 'prayer_focus'      then nullif(btrim(p->>'prayer_focus'), '')     else prayer_focus end,
    believing_for              = case when p ? 'believing_for'     then nullif(btrim(p->>'believing_for'), '')    else believing_for end,
    spiritual_gifts            = case when p ? 'spiritual_gifts'
                                      then coalesce(array(select jsonb_array_elements_text(p->'spiritual_gifts')), '{}'::text[])
                                      else spiritual_gifts end,
    credential_type            = case when p ? 'credential_type'   then nullif(p->>'credential_type', '')         else credential_type end,
    ordination_date            = case when p ? 'ordination_date'   then nullif(p->>'ordination_date', '')::date   else ordination_date end,
    ordained_by                = case when p ? 'ordained_by'       then nullif(btrim(p->>'ordained_by'), '')      else ordained_by end,
    covering_under             = case when p ? 'covering_under'    then nullif(btrim(p->>'covering_under'), '')   else covering_under end,
    credential_doc_path        = case when p ? 'credential_doc_path' then p->>'credential_doc_path'              else credential_doc_path end,
    credential_doc_uploaded_at = case when p ? 'credential_doc_uploaded_at'
                                      then (p->>'credential_doc_uploaded_at')::timestamptz
                                      else credential_doc_uploaded_at end
  where auth_user_id = uid
    and status = 'active';

  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'no active admin profile for this account';
  end if;
end;
$$;

revoke all on function public.update_my_admin_profile(jsonb) from public, anon;
grant execute on function public.update_my_admin_profile(jsonb) to authenticated;

-- Post-migration assertions -----------------------------------------
do $$
begin
  if not has_column_privilege('authenticated', 'public.rf_pastors', 'credential_doc_path', 'SELECT') then
    raise exception 'rf_pastors.credential_doc_path still unreadable';
  end if;
  if has_column_privilege('authenticated', 'public.rf_pastors', 'pin_bcrypt', 'SELECT')
     or has_column_privilege('authenticated', 'public.rf_admins', 'pin_bcrypt', 'SELECT') then
    raise exception 'pin_bcrypt became readable — abort';
  end if;
  if has_function_privilege('anon', 'public.update_my_admin_profile(jsonb)', 'EXECUTE') then
    raise exception 'anon can execute update_my_admin_profile';
  end if;
end $$;
