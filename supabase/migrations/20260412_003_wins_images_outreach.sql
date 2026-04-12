-- Adds image attachments to rf_wins and a per-leader outreach profile
-- used by the Gen Z / Gen Alpha growth suggester.
-- Run this in the Supabase SQL editor after deploying the HTML.

-- 1. Photo attachments on wins (mirrors rf_announcements.image_data)
alter table rf_wins add column if not exists image_data text;

-- 2. Outreach profiles: stores the questionnaire answers + last AI output
--    leader_id is the pastor_id OR the literal string 'bishop' for the bishop seat.
create table if not exists rf_outreach_profiles (
  id uuid primary key default gen_random_uuid(),
  leader_id text not null unique,
  city text,
  zip text,
  ministry_size text,
  genz_count text,
  age_makeup text,
  last_suggestions text,
  last_generated_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_outreach_leader on rf_outreach_profiles(leader_id);

alter table rf_outreach_profiles enable row level security;

-- Anon can read + write their own rows. The app scopes queries by leader_id
-- client-side, matching the pattern used by the rest of the RLS policies.
create policy "outreach_read"   on rf_outreach_profiles for select to anon using (true);
create policy "outreach_insert" on rf_outreach_profiles for insert to anon with check (true);
create policy "outreach_update" on rf_outreach_profiles for update to anon using (true) with check (true);
create policy "outreach_delete" on rf_outreach_profiles for delete to anon using (true);
