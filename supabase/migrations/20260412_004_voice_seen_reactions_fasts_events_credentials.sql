-- ============================================================
-- 20260412_004 — Voice blasts, seen-by, wins comments/reactions,
-- consecration (fasts), credentialing, and network events.
--
-- All statements are idempotent (if-not-exists guards) so this
-- migration is safe to replay over the live Supabase project.
-- It captures every schema change applied via MCP execute_sql
-- on 2026-04-12 after the initial ship-day migration.
-- ============================================================

-- ── Bishop voice blasts (From the Desk of the Bishop) ──
alter table rf_bishop_messages add column if not exists audio_url text;
alter table rf_bishop_messages add column if not exists audio_duration_seconds int;

-- ── Seen-by tracking for bishop blasts ──
create table if not exists rf_bishop_message_reads (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references rf_bishop_messages(id) on delete cascade,
  pastor_id uuid not null,
  pastor_name text,
  seen_at timestamptz default now(),
  unique(message_id, pastor_id)
);
create index if not exists idx_bmr_msg on rf_bishop_message_reads(message_id);
create index if not exists idx_bmr_pastor on rf_bishop_message_reads(pastor_id);
alter table rf_bishop_message_reads enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='rf_bishop_message_reads' and policyname='bmr_read') then
    create policy "bmr_read"   on rf_bishop_message_reads for select to anon using (true);
    create policy "bmr_insert" on rf_bishop_message_reads for insert to anon with check (true);
  end if;
end $$;

-- ── Wins wall: threaded comments ──
create table if not exists rf_win_comments (
  id uuid primary key default gen_random_uuid(),
  win_id uuid not null references rf_wins(id) on delete cascade,
  pastor_id uuid not null,
  pastor_name text,
  avatar_url text,
  comment_text text not null,
  created_at timestamptz default now()
);
create index if not exists idx_wc_win on rf_win_comments(win_id);
alter table rf_win_comments enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='rf_win_comments' and policyname='wc_read') then
    create policy "wc_read"   on rf_win_comments for select to anon using (true);
    create policy "wc_insert" on rf_win_comments for insert to anon with check (true);
    create policy "wc_update" on rf_win_comments for update to anon using (true) with check (true);
    create policy "wc_delete" on rf_win_comments for delete to anon using (true);
  end if;
end $$;

-- ── Wins wall: three new reaction counters (joining existing fire/glory) ──
alter table rf_wins add column if not exists clap_count  int default 0;
alter table rf_wins add column if not exists heart_count int default 0;
alter table rf_wins add column if not exists amen_count  int default 0;

-- ── Voice storage bucket for bishop blasts + future teachings ──
insert into storage.buckets (id, name, public)
values ('voice','voice',true)
on conflict (id) do update set public = true;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='voice_public_read') then
    create policy "voice_public_read" on storage.objects for select to anon using (bucket_id = 'voice');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='voice_anon_insert') then
    create policy "voice_anon_insert" on storage.objects for insert to anon with check (bucket_id = 'voice');
  end if;
end $$;

-- ── Consecration / Fasting ──
create table if not exists rf_fasts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  start_date date not null,
  end_date date not null,
  fast_type text,
  scripture_ref text,
  declared_by text,
  created_at timestamptz default now()
);
create index if not exists idx_fasts_dates on rf_fasts(start_date, end_date);
alter table rf_fasts enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='rf_fasts' and policyname='fasts_read') then
    create policy "fasts_read"   on rf_fasts for select to anon using (true);
    create policy "fasts_insert" on rf_fasts for insert to anon with check (true);
    create policy "fasts_update" on rf_fasts for update to anon using (true) with check (true);
    create policy "fasts_delete" on rf_fasts for delete to anon using (true);
  end if;
end $$;

create table if not exists rf_fast_participants (
  id uuid primary key default gen_random_uuid(),
  fast_id uuid not null references rf_fasts(id) on delete cascade,
  pastor_id uuid not null,
  pastor_name text,
  avatar_url text,
  joined_at timestamptz default now(),
  breakthrough_text text,
  breakthrough_at timestamptz,
  unique(fast_id, pastor_id)
);
create index if not exists idx_fp_fast on rf_fast_participants(fast_id);
alter table rf_fast_participants enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='rf_fast_participants' and policyname='fp_read') then
    create policy "fp_read"   on rf_fast_participants for select to anon using (true);
    create policy "fp_insert" on rf_fast_participants for insert to anon with check (true);
    create policy "fp_update" on rf_fast_participants for update to anon using (true) with check (true);
  end if;
end $$;

-- ── Ordination / Credentialing on pastors ──
alter table rf_pastors add column if not exists credential_type   text;
alter table rf_pastors add column if not exists ordination_date   date;
alter table rf_pastors add column if not exists ordained_by       text;
alter table rf_pastors add column if not exists covering_under    text;
alter table rf_pastors add column if not exists credential_status text default 'active';

-- ── Network events / calendar ──
create table if not exists rf_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  event_type text,
  event_date date not null,
  event_time text,
  end_date date,
  location text,
  location_url text,
  is_virtual boolean default false,
  created_by text,
  pastor_id text,
  pastor_name text,
  church_name text,
  created_at timestamptz default now()
);
create index if not exists idx_events_date on rf_events(event_date);
alter table rf_events enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='rf_events' and policyname='events_read') then
    create policy "events_read"   on rf_events for select to anon using (true);
    create policy "events_insert" on rf_events for insert to anon with check (true);
    create policy "events_update" on rf_events for update to anon using (true) with check (true);
    create policy "events_delete" on rf_events for delete to anon using (true);
  end if;
end $$;

-- Safety: if rf_events was created earlier without attribution columns,
-- this backfills them on replay.
alter table rf_events add column if not exists pastor_id   text;
alter table rf_events add column if not exists pastor_name text;
alter table rf_events add column if not exists church_name text;
