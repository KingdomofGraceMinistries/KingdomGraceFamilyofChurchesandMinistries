-- ============================================================
-- 2026-11-18 — opt-in public pastor profiles with a verified badge.
--
-- Operator's decisions (2026-11-18):
--   * a pastor's public page is OFF until the pastor turns it on;
--   * the public sees name, photo, church, city, credential type,
--     ordained by, covering, and a "Verified by Kingdom Grace" badge
--     once the bishop or an admin has checked the credential;
--   * the credential scan itself is NEVER public.
--
-- Shape:
--   rf_pastors.public_profile        — the pastor's own switch
--   rf_pastors.public_slug           — stable link id, minted server-side
--                                      the first time the switch goes on
--   rf_pastors.credential_verified_at / _by — set only through
--                                      set_credential_verified() (staff)
--
-- Public reads go through two SECURITY DEFINER functions that return
-- a fixed list of columns for active, opted-in pastors only. No table
-- policy is opened to anon. Verification is cleared automatically when
-- a pastor changes any credential field or uploads a new scan, so a
-- badge always refers to what staff actually checked.
-- ============================================================

alter table public.rf_pastors
  add column if not exists public_profile         boolean not null default false,
  add column if not exists public_slug            text,
  add column if not exists credential_verified_at timestamptz,
  add column if not exists credential_verified_by uuid;

create unique index if not exists rf_pastors_public_slug_key
  on public.rf_pastors (public_slug) where public_slug is not null;

-- Signed-in reads (network view, own profile). The pastor may flip only
-- their own switch; slug and verification are server-written.
grant select (public_profile, public_slug, credential_verified_at)
  on public.rf_pastors to authenticated;
grant update (public_profile) on public.rf_pastors to authenticated;

-- ── Trigger: mint the slug; clear verification on credential change ──
create or replace function public.rf_pastors_public_profile_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base  text;
  cand  text;
  tries int := 0;
begin
  if new.public_profile and new.public_slug is null then
    base := trim(both '-' from regexp_replace(lower(coalesce(new.full_name, 'pastor')), '[^a-z0-9]+', '-', 'g'));
    if base = '' then base := 'pastor'; end if;
    base := left(base, 40);
    loop
      cand := base || '-' || encode(extensions.gen_random_bytes(3), 'hex');
      exit when not exists (select 1 from public.rf_pastors where public_slug = cand);
      tries := tries + 1;
      if tries > 5 then raise exception 'could not mint a unique public link'; end if;
    end loop;
    new.public_slug := cand;
  end if;

  if tg_op = 'UPDATE'
     and not is_bishop()
     and (new.credential_type     is distinct from old.credential_type
       or new.ordination_date     is distinct from old.ordination_date
       or new.ordained_by         is distinct from old.ordained_by
       or new.covering_under      is distinct from old.covering_under
       or new.credential_doc_path is distinct from old.credential_doc_path) then
    new.credential_verified_at := null;
    new.credential_verified_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists rf_pastors_public_profile_guard on public.rf_pastors;
create trigger rf_pastors_public_profile_guard
  before insert or update on public.rf_pastors
  for each row execute function public.rf_pastors_public_profile_guard();

-- ── Staff: verify / un-verify a pastor's credential ──
create or replace function public.set_credential_verified(p_pastor_id uuid, p_verified boolean)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := coalesce(current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'role', '');
  v_at   timestamptz;
begin
  if not is_bishop() then
    raise exception 'forbidden: only the bishop or an admin may verify credentials';
  end if;
  if p_verified and not exists (
    select 1 from rf_pastors where id = p_pastor_id and credential_type is not null) then
    raise exception 'this pastor has no credential on their profile to verify';
  end if;

  update rf_pastors
     set credential_verified_at = case when p_verified then now() else null end,
         credential_verified_by = case when p_verified then auth.uid() else null end
   where id = p_pastor_id
  returning credential_verified_at into v_at;
  if not found then
    raise exception 'pastor not found';
  end if;

  insert into rf_audit_log (event_type, actor_id, actor_role, target_table, target_id, metadata)
  values (case when p_verified then 'CREDENTIAL_VERIFIED' else 'CREDENTIAL_UNVERIFIED' end,
          auth.uid()::text, v_role, 'rf_pastors', p_pastor_id::text, '{}'::jsonb);
  return v_at;
end;
$$;

revoke all on function public.set_credential_verified(uuid, boolean) from public, anon;
grant execute on function public.set_credential_verified(uuid, boolean) to authenticated;

-- ── Public: one profile by link, and search by name / church / city ──
create or replace function public.get_public_pastor(p_slug text)
returns table (
  slug text, full_name text, avatar_url text, church_name text, city text,
  credential_type text, ordained_by text, covering_under text, verified_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public_slug, full_name, avatar_url, church_name, city,
         credential_type, ordained_by, covering_under, credential_verified_at
    from rf_pastors
   where public_slug = p_slug
     and public_profile
     and status = 'active';
$$;

create or replace function public.search_public_pastors(p_query text)
returns table (
  slug text, full_name text, avatar_url text, church_name text, city text,
  credential_type text, verified_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with q as (
    select '%' || replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat,
           length(btrim(coalesce(p_query, ''))) as len
  )
  select p.public_slug, p.full_name, p.avatar_url, p.church_name, p.city,
         p.credential_type, p.credential_verified_at
    from rf_pastors p, q
   where q.len between 2 and 80
     and p.public_profile
     and p.status = 'active'
     and (p.full_name ilike q.pat or p.church_name ilike q.pat or p.city ilike q.pat)
   order by p.full_name
   limit 25;
$$;

revoke all on function public.get_public_pastor(text)      from public;
revoke all on function public.search_public_pastors(text)  from public;
grant execute on function public.get_public_pastor(text)     to anon, authenticated;
grant execute on function public.search_public_pastors(text) to anon, authenticated;

-- Post-migration assertions -----------------------------------------
do $$
begin
  if has_column_privilege('authenticated', 'public.rf_pastors', 'credential_verified_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.rf_pastors', 'public_slug', 'UPDATE') then
    raise exception 'verification or slug is client-writable';
  end if;
  if has_column_privilege('anon', 'public.rf_pastors', 'full_name', 'SELECT') then
    raise exception 'anon can read rf_pastors directly';
  end if;
  if has_function_privilege('anon', 'public.set_credential_verified(uuid, boolean)', 'EXECUTE') then
    raise exception 'anon can verify credentials';
  end if;
end $$;
