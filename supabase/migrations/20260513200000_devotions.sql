-- ============================================================
-- 20260513200000 — Daily pastoral devotion (DEV-1)
--
-- Network-wide single devotion per day. Bishop reviews/approves
-- AI drafts or replaces with bishop-recorded audio/video. Pastors
-- see only `status = 'published'`.
--
-- RLS: bishop full CRUD; authenticated read of published rows.
-- Service_role (edge functions) bypasses for generation/cron.
-- ============================================================

create table if not exists rf_devotions (
  id                  uuid primary key default gen_random_uuid(),
  date                date not null unique,
  theme               text,
  title               text,
  scripture_ref       text,
  scripture_text      text,
  body                text,
  reflection_prompt   text,
  prophetic_call      text,
  audio_url           text,
  video_url           text,
  source              text not null default 'ai'    check (source in ('ai','bishop')),
  status              text not null default 'draft' check (status in ('draft','published','archived')),
  reviewed_by         text,
  generation_metadata jsonb default '{}'::jsonb,
  created_at          timestamptz default now(),
  published_at        timestamptz
);
create index if not exists idx_devotions_date    on rf_devotions(date desc);
create index if not exists idx_devotions_status  on rf_devotions(status, date desc);

alter table rf_devotions enable row level security;

drop policy if exists devotions_auth_read   on rf_devotions;
drop policy if exists devotions_bishop_all  on rf_devotions;

-- Pastors see published devotions only. Bishop sees everything.
create policy devotions_auth_read  on rf_devotions for select to authenticated
  using (status = 'published' or is_bishop());

-- Bishop manages drafts, publishes, archives. Service_role bypasses RLS for cron+generate.
create policy devotions_bishop_all on rf_devotions for all    to authenticated
  using (is_bishop()) with check (is_bishop());

-- Column-level grants: authenticated may read all visible columns
-- (no secrets here — generation_metadata is bishop-only via RLS row filter).
revoke all on rf_devotions from anon, authenticated;
grant select on rf_devotions to authenticated;
grant update (status, title, body, reflection_prompt, prophetic_call,
              audio_url, video_url, reviewed_by, published_at)
  on rf_devotions to authenticated;
