-- ============================================================
-- Kingdom Grace Pastoral Network — Database Schema
-- Run against Supabase SQL editor or via `supabase db push`
-- ============================================================

-- 1. TABLES
-- ============================================================

create table if not exists rf_pastors (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  full_name text not null,
  church_name text,
  city text,
  years_in_ministry int default 0,
  bio text,
  prayer_focus text,
  believing_for text,
  spiritual_gifts text[] default '{}',
  avatar_url text,
  pin_hash text,
  status text default 'active',
  last_checkin_at timestamptz,
  last_pulse_score int default 3,
  posts_this_week int default 0,
  created_at timestamptz default now()
);

create table if not exists rf_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  invited_name text,
  token text unique not null,
  accepted_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists rf_checkins (
  id uuid primary key default gen_random_uuid(),
  pastor_id uuid references rf_pastors(id),
  pulse_score int not null,
  notes text,
  week_number int,
  created_at timestamptz default now()
);

create table if not exists rf_team_responses (
  id uuid primary key default gen_random_uuid(),
  pastor_id uuid references rf_pastors(id),
  week_number int not null,
  response_text text not null,
  is_pinned bool default false,
  created_at timestamptz default now()
);

create table if not exists rf_prayer_requests (
  id uuid primary key default gen_random_uuid(),
  pastor_id uuid references rf_pastors(id),
  request_text text not null,
  status text default 'active',
  prayed_count int default 0,
  created_at timestamptz default now()
);

create table if not exists rf_wins (
  id uuid primary key default gen_random_uuid(),
  pastor_id uuid references rf_pastors(id),
  win_text text not null,
  is_pinned bool default false,
  fire_count int default 0,
  glory_count int default 0,
  created_at timestamptz default now()
);

create table if not exists rf_direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id text not null,
  recipient_id text not null,
  message_text text not null,
  is_read bool default false,
  created_at timestamptz default now()
);

create table if not exists rf_bishop_messages (
  id uuid primary key default gen_random_uuid(),
  message_text text not null,
  type text default 'blast',
  sent_at timestamptz default now()
);

create table if not exists rf_announcements (
  id uuid primary key default gen_random_uuid(),
  pastor_id text not null,
  title text default '',
  body text default '',
  image_data text,
  is_pinned bool default false,
  status text default 'active',
  created_at timestamptz default now()
);

-- 2. INDEXES for performance
-- ============================================================

create index if not exists idx_checkins_pastor on rf_checkins(pastor_id);
create index if not exists idx_checkins_week on rf_checkins(week_number);
create index if not exists idx_team_resp_week on rf_team_responses(week_number);
create index if not exists idx_prayer_status on rf_prayer_requests(status);
create index if not exists idx_wins_pinned on rf_wins(is_pinned);
create index if not exists idx_dm_sender on rf_direct_messages(sender_id);
create index if not exists idx_dm_recipient on rf_direct_messages(recipient_id);
create index if not exists idx_dm_read on rf_direct_messages(is_read);
create index if not exists idx_ann_status on rf_announcements(status);
create index if not exists idx_invites_token on rf_invites(token);

-- 3. ENABLE ROW LEVEL SECURITY
-- ============================================================

alter table rf_pastors enable row level security;
alter table rf_invites enable row level security;
alter table rf_checkins enable row level security;
alter table rf_team_responses enable row level security;
alter table rf_prayer_requests enable row level security;
alter table rf_wins enable row level security;
alter table rf_direct_messages enable row level security;
alter table rf_bishop_messages enable row level security;
alter table rf_announcements enable row level security;

-- 4. RLS POLICIES
-- ============================================================
-- This app uses the anon key directly (no Supabase Auth signup).
-- Pastors authenticate via PIN/biometric in the app layer.
-- RLS policies here use the anon role for reads (community data)
-- and restrict writes via service_role in the edge function.
--
-- For this MVP: anon can read public tables, writes go through
-- the REST API with the anon key. Future: migrate to Supabase Auth
-- with proper per-user RLS.

-- rf_pastors: anon can read active pastors, insert (registration), update own
create policy "pastors_read" on rf_pastors for select to anon using (true);
create policy "pastors_insert" on rf_pastors for insert to anon with check (true);
create policy "pastors_update" on rf_pastors for update to anon using (true) with check (true);

-- rf_invites: anon can read (to verify tokens) and insert (bishop creates)
create policy "invites_read" on rf_invites for select to anon using (true);
create policy "invites_insert" on rf_invites for insert to anon with check (true);
create policy "invites_update" on rf_invites for update to anon using (true) with check (true);

-- rf_checkins: anon can read all (bishop needs visibility) and insert
create policy "checkins_read" on rf_checkins for select to anon using (true);
create policy "checkins_insert" on rf_checkins for insert to anon with check (true);

-- rf_team_responses: community-readable, pastor can insert
create policy "team_read" on rf_team_responses for select to anon using (true);
create policy "team_insert" on rf_team_responses for insert to anon with check (true);
create policy "team_update" on rf_team_responses for update to anon using (true) with check (true);

-- rf_prayer_requests: community-readable, pastor can insert, bishop can update status
create policy "prayer_read" on rf_prayer_requests for select to anon using (true);
create policy "prayer_insert" on rf_prayer_requests for insert to anon with check (true);
create policy "prayer_update" on rf_prayer_requests for update to anon using (true) with check (true);

-- rf_wins: community-readable, pastor can insert, bishop can pin/update
create policy "wins_read" on rf_wins for select to anon using (true);
create policy "wins_insert" on rf_wins for insert to anon with check (true);
create policy "wins_update" on rf_wins for update to anon using (true) with check (true);
create policy "wins_delete" on rf_wins for delete to anon using (true);

-- rf_direct_messages: readable (app filters by sender/recipient), insertable
create policy "dm_read" on rf_direct_messages for select to anon using (true);
create policy "dm_insert" on rf_direct_messages for insert to anon with check (true);
create policy "dm_update" on rf_direct_messages for update to anon using (true) with check (true);

-- rf_bishop_messages: readable by all pastors, insertable by bishop (app-enforced)
create policy "bishop_msg_read" on rf_bishop_messages for select to anon using (true);
create policy "bishop_msg_insert" on rf_bishop_messages for insert to anon with check (true);

-- rf_announcements: community-readable, insertable, updatable (pin/delete)
create policy "ann_read" on rf_announcements for select to anon using (true);
create policy "ann_insert" on rf_announcements for insert to anon with check (true);
create policy "ann_update" on rf_announcements for update to anon using (true) with check (true);
create policy "ann_delete" on rf_announcements for delete to anon using (true);

-- 5. WEEKLY RESET FUNCTION (for posts_this_week counter)
-- ============================================================
-- Schedule this as a Supabase cron job: every Monday at 00:00 UTC

create or replace function reset_weekly_post_counts()
returns void as $$
begin
  update rf_pastors set posts_this_week = 0;
end;
$$ language plpgsql security definer;

-- To schedule (run in SQL editor):
-- select cron.schedule('reset-weekly-posts', '0 0 * * 1', 'select reset_weekly_post_counts()');
