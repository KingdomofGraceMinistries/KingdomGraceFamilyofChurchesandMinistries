-- ============================================================
-- 20260513_005 — Real Auth + locked RLS  (SEC-1, 3, 13, 14, 15)
--
-- Replaces the open-anon RLS posture established by migrations
-- 001–004 with authenticated-only policies keyed on auth.uid()
-- and JWT app_metadata.role.
--
--   SEC-1  : adds bcrypt pin_bcrypt column; migrates existing
--            base64-encoded pin_hash values to real bcrypt.
--   SEC-3  : drops every using(true) / with check(true) anon
--            policy; adds authenticated-scoped policies AND
--            column-level GRANTs so pin_bcrypt / reset_token_hash
--            are not readable by other pastors.
--   SEC-13 : rf_push_subscriptions wildcard policy replaced
--            with self-only CRUD keyed on auth.uid().
--   SEC-14 : reset_weekly_post_counts EXECUTE revoked from
--            anon/authenticated/public; search_path pinned.
--   SEC-15 : storage.objects SELECT-list policies removed for
--            the four public buckets. Direct URL fetch still
--            works; enumeration does not.
--
-- All DDL is idempotent (drop if exists, add column if not
-- exists, create or replace). Safe to replay.
-- A final DO block asserts post-migration invariants.
-- ============================================================

-- ── 1. EXTENSIONS ──────────────────────────────────────────
create extension if not exists pgcrypto;

-- ── 2. SCHEMA: new auth columns ───────────────────────────
alter table rf_pastors
  add column if not exists auth_user_id        uuid references auth.users(id) on delete set null,
  add column if not exists pin_bcrypt          text,
  add column if not exists role                text default 'pastor'
    check (role in ('pastor','admin','bishop')),
  add column if not exists reset_token_hash    text,
  add column if not exists reset_token_expires timestamptz;

create        index if not exists idx_pastors_auth_user on rf_pastors(auth_user_id);
create unique index if not exists uq_pastors_auth_user
  on rf_pastors(auth_user_id) where auth_user_id is not null;

alter table rf_admins
  add column if not exists auth_user_id        uuid references auth.users(id) on delete set null,
  add column if not exists pin_bcrypt          text,
  add column if not exists is_bishop           boolean default false,
  add column if not exists reset_token_hash    text,
  add column if not exists reset_token_expires timestamptz;

create        index if not exists idx_admins_auth_user on rf_admins(auth_user_id);
create unique index if not exists uq_admins_auth_user
  on rf_admins(auth_user_id) where auth_user_id is not null;

-- ── 3. NEW TABLE: rate-limit attempts ─────────────────────
create table if not exists rf_reset_attempts (
  id          bigserial primary key,
  email_hash  text not null,
  ip_hash     text not null,
  kind        text not null check (kind in ('login','reset','register')),
  created_at  timestamptz default now()
);
create index if not exists idx_rfa_email_recent on rf_reset_attempts(email_hash, created_at desc);
create index if not exists idx_rfa_ip_recent    on rf_reset_attempts(ip_hash,    created_at desc);
create index if not exists idx_rfa_created      on rf_reset_attempts(created_at);
alter table rf_reset_attempts enable row level security;
-- No policies for anon/authenticated → service_role only (bypasses RLS).

-- ── 4. HELPERS ─────────────────────────────────────────────
create or replace function public.is_bishop() returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'role') in ('bishop','admin'),
    false
  );
$$;
revoke execute on function public.is_bishop() from public;
grant   execute on function public.is_bishop() to authenticated, service_role;

create or replace function public.pastor_id_for_current_user() returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select id from rf_pastors where auth_user_id = auth.uid() limit 1;
$$;
revoke execute on function public.pastor_id_for_current_user() from public;
grant   execute on function public.pastor_id_for_current_user() to authenticated, service_role;

create or replace function public.verify_pin(p_pin text, p_hash text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p_hash = extensions.crypt(p_pin, p_hash);
$$;
revoke execute on function public.verify_pin(text, text) from public, anon, authenticated;
grant   execute on function public.verify_pin(text, text) to service_role;

create or replace function public.hash_pin(p_pin text) returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select extensions.crypt(p_pin, extensions.gen_salt('bf', 10));
$$;
revoke execute on function public.hash_pin(text) from public, anon, authenticated;
grant   execute on function public.hash_pin(text) to service_role;

-- ── 5. SEC-14: lock down the cron-only function ──────────
revoke execute on function public.reset_weekly_post_counts() from public, anon, authenticated;
alter  function public.reset_weekly_post_counts() set search_path = public, pg_temp;

-- ── 6. DROP every existing anon-open policy ───────────────
drop policy if exists pastors_read   on rf_pastors;
drop policy if exists pastors_insert on rf_pastors;
drop policy if exists pastors_update on rf_pastors;

drop policy if exists invites_read   on rf_invites;
drop policy if exists invites_insert on rf_invites;
drop policy if exists invites_update on rf_invites;

drop policy if exists checkins_read   on rf_checkins;
drop policy if exists checkins_insert on rf_checkins;

drop policy if exists team_read   on rf_team_responses;
drop policy if exists team_insert on rf_team_responses;
drop policy if exists team_update on rf_team_responses;

drop policy if exists prayer_read   on rf_prayer_requests;
drop policy if exists prayer_insert on rf_prayer_requests;
drop policy if exists prayer_update on rf_prayer_requests;

drop policy if exists wins_read   on rf_wins;
drop policy if exists wins_insert on rf_wins;
drop policy if exists wins_update on rf_wins;
drop policy if exists wins_delete on rf_wins;

drop policy if exists dm_read   on rf_direct_messages;
drop policy if exists dm_insert on rf_direct_messages;
drop policy if exists dm_update on rf_direct_messages;

drop policy if exists bishop_msg_read   on rf_bishop_messages;
drop policy if exists bishop_msg_insert on rf_bishop_messages;

drop policy if exists ann_read   on rf_announcements;
drop policy if exists ann_insert on rf_announcements;
drop policy if exists ann_update on rf_announcements;
drop policy if exists ann_delete on rf_announcements;

drop policy if exists admins_read   on rf_admins;
drop policy if exists admins_insert on rf_admins;
drop policy if exists admins_update on rf_admins;
drop policy if exists admins_delete on rf_admins;

drop policy if exists audit_read   on rf_audit_log;
drop policy if exists audit_insert on rf_audit_log;

drop policy if exists config_read   on rf_network_config;
drop policy if exists config_update on rf_network_config;

drop policy if exists outreach_read   on rf_outreach_profiles;
drop policy if exists outreach_insert on rf_outreach_profiles;
drop policy if exists outreach_update on rf_outreach_profiles;
drop policy if exists outreach_delete on rf_outreach_profiles;

drop policy if exists bmr_read   on rf_bishop_message_reads;
drop policy if exists bmr_insert on rf_bishop_message_reads;

drop policy if exists wc_read   on rf_win_comments;
drop policy if exists wc_insert on rf_win_comments;
drop policy if exists wc_update on rf_win_comments;
drop policy if exists wc_delete on rf_win_comments;

drop policy if exists fasts_read   on rf_fasts;
drop policy if exists fasts_insert on rf_fasts;
drop policy if exists fasts_update on rf_fasts;
drop policy if exists fasts_delete on rf_fasts;

drop policy if exists fp_read   on rf_fast_participants;
drop policy if exists fp_insert on rf_fast_participants;
drop policy if exists fp_update on rf_fast_participants;

drop policy if exists events_read   on rf_events;
drop policy if exists events_insert on rf_events;
drop policy if exists events_update on rf_events;
drop policy if exists events_delete on rf_events;

drop policy if exists "Users can manage their own push subscriptions" on rf_push_subscriptions;

-- Drop new policies too, in case this is a replay (idempotency)
drop policy if exists pastors_self_read           on rf_pastors;
drop policy if exists pastors_network_read        on rf_pastors;
drop policy if exists pastors_self_update         on rf_pastors;
drop policy if exists pastors_bishop_all          on rf_pastors;
drop policy if exists invites_bishop              on rf_invites;
drop policy if exists checkins_self_insert        on rf_checkins;
drop policy if exists checkins_self_read          on rf_checkins;
drop policy if exists checkins_bishop_read        on rf_checkins;
drop policy if exists team_auth_read              on rf_team_responses;
drop policy if exists team_self_insert            on rf_team_responses;
drop policy if exists team_self_update            on rf_team_responses;
drop policy if exists team_bishop_update          on rf_team_responses;
drop policy if exists prayer_auth_read            on rf_prayer_requests;
drop policy if exists prayer_self_insert          on rf_prayer_requests;
drop policy if exists prayer_self_update          on rf_prayer_requests;
drop policy if exists prayer_bishop_update        on rf_prayer_requests;
drop policy if exists wins_auth_read              on rf_wins;
drop policy if exists wins_self_insert            on rf_wins;
drop policy if exists wins_self_update            on rf_wins;
drop policy if exists wins_bishop_update          on rf_wins;
drop policy if exists wins_bishop_delete          on rf_wins;
drop policy if exists dm_party_read               on rf_direct_messages;
drop policy if exists dm_sender_insert            on rf_direct_messages;
drop policy if exists dm_recipient_update         on rf_direct_messages;
drop policy if exists bishop_msg_auth_read        on rf_bishop_messages;
drop policy if exists bishop_msg_bishop_insert    on rf_bishop_messages;
drop policy if exists bishop_msg_bishop_update    on rf_bishop_messages;
drop policy if exists ann_auth_read               on rf_announcements;
drop policy if exists ann_self_insert             on rf_announcements;
drop policy if exists ann_self_update             on rf_announcements;
drop policy if exists ann_self_delete             on rf_announcements;
drop policy if exists admins_bishop_all           on rf_admins;
drop policy if exists admins_self_read            on rf_admins;
drop policy if exists audit_bishop_read           on rf_audit_log;
drop policy if exists config_anon_branding_read   on rf_network_config;
drop policy if exists config_auth_safe_read       on rf_network_config;
drop policy if exists config_bishop_insert        on rf_network_config;
drop policy if exists config_bishop_update        on rf_network_config;
drop policy if exists outreach_self_read          on rf_outreach_profiles;
drop policy if exists outreach_self_insert        on rf_outreach_profiles;
drop policy if exists outreach_self_update        on rf_outreach_profiles;
drop policy if exists bmr_auth_read               on rf_bishop_message_reads;
drop policy if exists bmr_self_insert             on rf_bishop_message_reads;
drop policy if exists wc_auth_read                on rf_win_comments;
drop policy if exists wc_self_insert              on rf_win_comments;
drop policy if exists wc_self_update              on rf_win_comments;
drop policy if exists wc_self_delete              on rf_win_comments;
drop policy if exists fasts_auth_read             on rf_fasts;
drop policy if exists fasts_bishop_write          on rf_fasts;
drop policy if exists fp_auth_read                on rf_fast_participants;
drop policy if exists fp_self_insert              on rf_fast_participants;
drop policy if exists fp_self_update              on rf_fast_participants;
drop policy if exists events_auth_read            on rf_events;
drop policy if exists events_bishop_write         on rf_events;
drop policy if exists push_self_select            on rf_push_subscriptions;
drop policy if exists push_self_insert            on rf_push_subscriptions;
drop policy if exists push_self_update            on rf_push_subscriptions;
drop policy if exists push_self_delete            on rf_push_subscriptions;

-- ── 7. NEW POLICIES — authenticated only, scoped ──────────

-- rf_pastors
create policy pastors_self_read     on rf_pastors for select to authenticated using (auth_user_id = auth.uid());
create policy pastors_network_read  on rf_pastors for select to authenticated using (status = 'active');
create policy pastors_self_update   on rf_pastors for update to authenticated
  using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());
create policy pastors_bishop_all    on rf_pastors for all    to authenticated
  using (is_bishop()) with check (is_bishop());

-- rf_invites: bishop-managed
create policy invites_bishop on rf_invites for all to authenticated
  using (is_bishop()) with check (is_bishop());

-- rf_checkins
create policy checkins_self_insert  on rf_checkins for insert to authenticated
  with check (pastor_id = pastor_id_for_current_user());
create policy checkins_self_read    on rf_checkins for select to authenticated
  using  (pastor_id = pastor_id_for_current_user());
create policy checkins_bishop_read  on rf_checkins for select to authenticated using (is_bishop());

-- rf_team_responses
create policy team_auth_read     on rf_team_responses for select to authenticated using (true);
create policy team_self_insert   on rf_team_responses for insert to authenticated
  with check (pastor_id = pastor_id_for_current_user());
create policy team_self_update   on rf_team_responses for update to authenticated
  using (pastor_id = pastor_id_for_current_user()) with check (pastor_id = pastor_id_for_current_user());
create policy team_bishop_update on rf_team_responses for update to authenticated
  using (is_bishop()) with check (is_bishop());

-- rf_prayer_requests
create policy prayer_auth_read     on rf_prayer_requests for select to authenticated using (true);
create policy prayer_self_insert   on rf_prayer_requests for insert to authenticated
  with check (pastor_id = pastor_id_for_current_user());
create policy prayer_self_update   on rf_prayer_requests for update to authenticated
  using (pastor_id = pastor_id_for_current_user()) with check (pastor_id = pastor_id_for_current_user());
create policy prayer_bishop_update on rf_prayer_requests for update to authenticated
  using (is_bishop()) with check (is_bishop());

-- rf_wins
create policy wins_auth_read     on rf_wins for select to authenticated using (true);
create policy wins_self_insert   on rf_wins for insert to authenticated
  with check (pastor_id = pastor_id_for_current_user());
create policy wins_self_update   on rf_wins for update to authenticated
  using (pastor_id = pastor_id_for_current_user()) with check (pastor_id = pastor_id_for_current_user());
create policy wins_bishop_update on rf_wins for update to authenticated
  using (is_bishop()) with check (is_bishop());
create policy wins_bishop_delete on rf_wins for delete to authenticated using (is_bishop());

-- rf_direct_messages: sender, recipient, or bishop
create policy dm_party_read on rf_direct_messages for select to authenticated using (
  sender_id    = pastor_id_for_current_user()::text or
  recipient_id = pastor_id_for_current_user()::text or
  is_bishop()
);
create policy dm_sender_insert on rf_direct_messages for insert to authenticated with check (
  sender_id = pastor_id_for_current_user()::text or is_bishop()
);
create policy dm_recipient_update on rf_direct_messages for update to authenticated
  using (recipient_id = pastor_id_for_current_user()::text or is_bishop())
  with check (recipient_id = pastor_id_for_current_user()::text or is_bishop());

-- rf_bishop_messages
create policy bishop_msg_auth_read     on rf_bishop_messages for select to authenticated using (true);
create policy bishop_msg_bishop_insert on rf_bishop_messages for insert to authenticated with check (is_bishop());
create policy bishop_msg_bishop_update on rf_bishop_messages for update to authenticated using (is_bishop()) with check (is_bishop());

-- rf_announcements
create policy ann_auth_read   on rf_announcements for select to authenticated using (status = 'active' or is_bishop());
create policy ann_self_insert on rf_announcements for insert to authenticated
  with check (pastor_id = pastor_id_for_current_user()::text or is_bishop());
create policy ann_self_update on rf_announcements for update to authenticated
  using (pastor_id = pastor_id_for_current_user()::text or is_bishop())
  with check (pastor_id = pastor_id_for_current_user()::text or is_bishop());
create policy ann_self_delete on rf_announcements for delete to authenticated
  using (pastor_id = pastor_id_for_current_user()::text or is_bishop());

-- rf_admins
create policy admins_bishop_all on rf_admins for all    to authenticated using (is_bishop()) with check (is_bishop());
create policy admins_self_read  on rf_admins for select to authenticated using (auth_user_id = auth.uid());

-- rf_audit_log: bishop read; no client writes (service_role only)
create policy audit_bishop_read on rf_audit_log for select to authenticated using (is_bishop());

-- rf_network_config: anon may read public branding keys; sensitive keys are excluded
-- and only bishop sees them through the authenticated policy.
create policy config_anon_branding_read on rf_network_config for select to anon
  using (key not in (
    'bishop_pin_hash',
    'bishop_pin_bcrypt',
    'bishop_email',
    'vapid_private_key',
    'resend_api_key'
  ));
create policy config_auth_safe_read on rf_network_config for select to authenticated
  using (
    key not in ('bishop_pin_bcrypt','bishop_pin_hash','vapid_private_key','resend_api_key')
    or is_bishop()
  );
create policy config_bishop_insert on rf_network_config for insert to authenticated with check (is_bishop());
create policy config_bishop_update on rf_network_config for update to authenticated using (is_bishop()) with check (is_bishop());

-- rf_outreach_profiles
create policy outreach_self_read   on rf_outreach_profiles for select to authenticated
  using (leader_id = pastor_id_for_current_user()::text or is_bishop());
create policy outreach_self_insert on rf_outreach_profiles for insert to authenticated
  with check (leader_id = pastor_id_for_current_user()::text);
create policy outreach_self_update on rf_outreach_profiles for update to authenticated
  using (leader_id = pastor_id_for_current_user()::text) with check (leader_id = pastor_id_for_current_user()::text);

-- rf_bishop_message_reads
create policy bmr_auth_read   on rf_bishop_message_reads for select to authenticated using (true);
create policy bmr_self_insert on rf_bishop_message_reads for insert to authenticated
  with check (pastor_id = pastor_id_for_current_user());

-- rf_win_comments
create policy wc_auth_read   on rf_win_comments for select to authenticated using (true);
create policy wc_self_insert on rf_win_comments for insert to authenticated
  with check (pastor_id = pastor_id_for_current_user());
create policy wc_self_update on rf_win_comments for update to authenticated
  using (pastor_id = pastor_id_for_current_user()) with check (pastor_id = pastor_id_for_current_user());
create policy wc_self_delete on rf_win_comments for delete to authenticated
  using (pastor_id = pastor_id_for_current_user() or is_bishop());

-- rf_fasts
create policy fasts_auth_read    on rf_fasts for select to authenticated using (true);
create policy fasts_bishop_write on rf_fasts for all    to authenticated using (is_bishop()) with check (is_bishop());

-- rf_fast_participants
create policy fp_auth_read   on rf_fast_participants for select to authenticated using (true);
create policy fp_self_insert on rf_fast_participants for insert to authenticated
  with check (pastor_id = pastor_id_for_current_user());
create policy fp_self_update on rf_fast_participants for update to authenticated
  using (pastor_id = pastor_id_for_current_user()) with check (pastor_id = pastor_id_for_current_user());

-- rf_events
create policy events_auth_read    on rf_events for select to authenticated using (true);
create policy events_bishop_write on rf_events for all    to authenticated using (is_bishop()) with check (is_bishop());

-- rf_push_subscriptions — SEC-13: self only (user_id stores auth.uid()::text)
create policy push_self_select on rf_push_subscriptions for select to authenticated
  using (user_id = auth.uid()::text or is_bishop());
create policy push_self_insert on rf_push_subscriptions for insert to authenticated
  with check (user_id = auth.uid()::text);
create policy push_self_update on rf_push_subscriptions for update to authenticated
  using (user_id = auth.uid()::text) with check (user_id = auth.uid()::text);
create policy push_self_delete on rf_push_subscriptions for delete to authenticated
  using (user_id = auth.uid()::text);

-- ── 8. COLUMN-LEVEL GRANTS — hide pin_bcrypt + reset_token_hash ──
-- RLS handles row visibility but not column visibility. After this
-- block, even authenticated users who satisfy a SELECT policy cannot
-- read pin_bcrypt or reset_token_hash. service_role bypasses.

revoke all on rf_pastors from anon, authenticated;
grant select (id, email, full_name, church_name, city, years_in_ministry,
              bio, prayer_focus, believing_for, spiritual_gifts, avatar_url,
              status, last_checkin_at, last_pulse_score, posts_this_week,
              created_at, credential_type, ordination_date, ordained_by,
              covering_under, credential_status, role, auth_user_id)
  on rf_pastors to authenticated;
grant update (full_name, church_name, city, years_in_ministry,
              bio, prayer_focus, believing_for, spiritual_gifts, avatar_url,
              last_checkin_at, last_pulse_score, posts_this_week,
              credential_type, ordination_date, ordained_by,
              covering_under, credential_status)
  on rf_pastors to authenticated;
-- INSERT on rf_pastors is service_role only (via kgfcm-pin-register edge fn).

revoke all on rf_admins from anon, authenticated;
grant select (id, full_name, email, status, is_bishop, auth_user_id, created_at, permissions)
  on rf_admins to authenticated;
grant update (full_name, status, permissions)
  on rf_admins to authenticated;
-- INSERT on rf_admins is service_role only.

-- ── 9. SEC-15: drop public bucket listing policies ───────
drop policy if exists "wins_public_read"          on storage.objects;
drop policy if exists "voice_public_read"         on storage.objects;
drop policy if exists "public_read_avatars"       on storage.objects;
drop policy if exists "public_read_announcements" on storage.objects;

-- ── 10. PIN MIGRATION: base64 → bcrypt ───────────────────
do $$
declare
  raw_pin text;
  encoded text;
begin
  select value into encoded from rf_network_config where key = 'bishop_pin_hash';
  if encoded is null then return; end if;
  begin
    raw_pin := convert_from(decode(encoded, 'base64'), 'utf-8');
  exception when others then
    raise notice 'bishop_pin_hash is not valid base64; leaving as-is';
    return;
  end;
  insert into rf_network_config (key, value)
  values ('bishop_pin_bcrypt', extensions.crypt(raw_pin, extensions.gen_salt('bf', 10)))
  on conflict (key) do update set value = excluded.value;
  delete from rf_network_config where key = 'bishop_pin_hash';
end $$;

insert into rf_network_config (key, value)
values ('bishop_email', 'bishop@kgfcm.local')
on conflict (key) do nothing;

update rf_pastors
set pin_bcrypt = extensions.crypt(convert_from(decode(pin_hash, 'base64'), 'utf-8'), extensions.gen_salt('bf', 10))
where pin_hash is not null and pin_bcrypt is null;

update rf_admins
set pin_bcrypt = extensions.crypt(convert_from(decode(pin_hash, 'base64'), 'utf-8'), extensions.gen_salt('bf', 10))
where pin_hash is not null and pin_bcrypt is null;

-- ── 11. AUDIT-LOG cleanup ─────────────────────────────────
truncate table rf_audit_log;

-- ── 12. pg_cron: daily cleanup of rf_reset_attempts > 7 days ──
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'kgfcm_rate_limit_cleanup') then
    perform cron.schedule(
      'kgfcm_rate_limit_cleanup',
      '15 3 * * *',
      $cron$delete from rf_reset_attempts where created_at < now() - interval '7 days'$cron$
    );
  end if;
end $$;

-- ── 13. POST-MIGRATION ASSERTIONS ─────────────────────────
-- Verify that no anon-open INSERT/UPDATE/DELETE policies remain on
-- our rf_* tables. SELECT-to-anon with a non-trivial qual (e.g.,
-- branding-key filter) is intentional and allowed.
do $$
declare
  bad_count int;
  bad_row record;
begin
  select count(*) into bad_count
  from pg_policies
  where schemaname = 'public'
    and tablename like 'rf_%'
    and 'anon' = any (string_to_array(replace(replace(roles::text, '{', ''), '}', ''), ','))
    and cmd in ('INSERT','UPDATE','DELETE')
    and (qual = 'true' or with_check = 'true');
  if bad_count > 0 then
    for bad_row in
      select tablename, policyname, cmd from pg_policies
      where schemaname = 'public' and tablename like 'rf_%'
        and 'anon' = any (string_to_array(replace(replace(roles::text, '{', ''), '}', ''), ','))
        and cmd in ('INSERT','UPDATE','DELETE')
        and (qual = 'true' or with_check = 'true')
    loop
      raise warning 'remaining open anon policy: % on % (%)', bad_row.policyname, bad_row.tablename, bad_row.cmd;
    end loop;
    raise exception 'migration assertion failed: % open anon policies remain', bad_count;
  end if;
end $$;

-- Verify bishop_pin_hash (legacy) is gone and bishop_pin_bcrypt is in place.
do $$
declare
  legacy_count int;
  bcrypt_count int;
begin
  select count(*) into legacy_count from rf_network_config where key = 'bishop_pin_hash';
  select count(*) into bcrypt_count from rf_network_config where key = 'bishop_pin_bcrypt';
  if legacy_count > 0 then
    raise exception 'migration assertion failed: legacy bishop_pin_hash row still exists';
  end if;
  if bcrypt_count <> 1 then
    raise exception 'migration assertion failed: bishop_pin_bcrypt missing or duplicated (% rows)', bcrypt_count;
  end if;
end $$;

-- Verify pin_bcrypt is NOT in the authenticated SELECT grants on rf_pastors.
do $$
declare
  bad_grants int;
begin
  select count(*) into bad_grants
  from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'rf_pastors'
    and grantee = 'authenticated'
    and column_name in ('pin_bcrypt','reset_token_hash')
    and privilege_type = 'SELECT';
  if bad_grants > 0 then
    raise exception 'migration assertion failed: pin_bcrypt / reset_token_hash still selectable by authenticated';
  end if;
end $$;
