-- ============================================================
-- SHIP-DAY CONFIG FOR KINGDOM GRACE — 2026-04-12
-- Run this entire file in the Supabase SQL Editor.
-- Then: redeploy kgfcm-ai-proxy edge function (see bottom).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Run the new migration (wins.image_data + rf_outreach_profiles)
--    If you manage migrations via the Supabase CLI, skip this block
--    and run `npx supabase db push` from the project root instead.
-- ------------------------------------------------------------
alter table rf_wins add column if not exists image_data text;

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
do $$ begin
  if not exists (select 1 from pg_policies where tablename='rf_outreach_profiles' and policyname='outreach_read') then
    create policy "outreach_read"   on rf_outreach_profiles for select to anon using (true);
    create policy "outreach_insert" on rf_outreach_profiles for insert to anon with check (true);
    create policy "outreach_update" on rf_outreach_profiles for update to anon using (true) with check (true);
    create policy "outreach_delete" on rf_outreach_profiles for delete to anon using (true);
  end if;
end $$;

-- ------------------------------------------------------------
-- 2. Create the public 'wins' storage bucket for Win Wall photos
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('wins','wins',true)
on conflict (id) do update set public = true;

-- Allow anon uploads/reads/updates into the wins bucket
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='wins_public_read') then
    create policy "wins_public_read" on storage.objects for select to anon using (bucket_id = 'wins');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='wins_anon_insert') then
    create policy "wins_anon_insert" on storage.objects for insert to anon with check (bucket_id = 'wins');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='wins_anon_update') then
    create policy "wins_anon_update" on storage.objects for update to anon using (bucket_id = 'wins') with check (bucket_id = 'wins');
  end if;
end $$;

-- ------------------------------------------------------------
-- 3. Point photo URLs at the files committed to the Vercel deploy
--    (these live at the site root since they're tracked in the repo)
-- ------------------------------------------------------------
insert into rf_network_config (key, value) values
  ('bishop_photo_url',  '/Bishop%20Sasser.jpg'),
  ('apostle_photo_url', '/Bishop%20Sasser%20and%20Eraka.jpg'),
  ('couple_photo_url',  '/Bishop%20and%20Apostle.jpg')
on conflict (key) do update set value = excluded.value;

-- ------------------------------------------------------------
-- 4. Warmer cream/beige light theme
--    Replaces the existing 'themes' JSON with a softer warm palette.
--    The dark theme stays the tenant default; pastors who switch to
--    the light theme in Settings now get a warmer, less-bright tone.
-- ------------------------------------------------------------
insert into rf_network_config (key, value) values ('themes', $JSON$
{
  "default": "dark",
  "tip": "Pastors can switch themes in Settings.",
  "options": [
    {
      "id": "dark",
      "label": "Midnight Gold",
      "description": "Default — black & gold, low-light friendly",
      "palette": {
        "ink":  "#0a0a0f",
        "ink2": "#14141c",
        "ink3": "#1e1e28",
        "ink4": "#282836",
        "gold": "#c8a84c",
        "gold2":"#e8c86a",
        "gold3":"rgba(201,168,76,0.14)",
        "gold4":"rgba(201,168,76,0.07)",
        "frost":"#f8f6f0",
        "mist": "#a8a090",
        "ash":  "#6a6258",
        "flame":"#e85d3a",
        "sage": "#4a8c6a",
        "sky":  "#3a6ea8",
        "thrive":"#4a8c6a",
        "info2":"#3a6ea8",
        "br":   "rgba(201,168,76,0.18)",
        "brh":  "rgba(201,168,76,0.38)"
      }
    },
    {
      "id": "cream",
      "label": "Parchment",
      "description": "Warm cream — easy on daylight eyes",
      "palette": {
        "ink":  "#f1e7cf",
        "ink2": "#e9ddbf",
        "ink3": "#e0d2ad",
        "ink4": "#d4c399",
        "gold": "#8a6a1c",
        "gold2":"#a8822a",
        "gold3":"rgba(138,106,28,0.14)",
        "gold4":"rgba(138,106,28,0.07)",
        "frost":"#2a1f0a",
        "mist": "#5a4a28",
        "ash":  "#8a7a52",
        "flame":"#b94a2a",
        "sage": "#3c6a4a",
        "sky":  "#2a527a",
        "thrive":"#3c6a4a",
        "info2":"#2a527a",
        "br":   "rgba(80,55,15,0.22)",
        "brh":  "rgba(80,55,15,0.42)"
      }
    }
  ]
}
$JSON$)
on conflict (key) do update set value = excluded.value;

-- ============================================================
-- AFTER RUNNING THIS SQL:
--
-- 1. Redeploy the AI proxy so the new 'outreach' callType is live:
--      npx supabase functions deploy kgfcm-ai-proxy --no-verify-jwt
--
-- 2. Hard-reload the app in your browser (Cmd/Ctrl + Shift + R) so
--    the new config and HTML are picked up.
--
-- 3. In the app, open Outreach Insights, enter city + demographics,
--    and tap Generate to see your first suggestions.
-- ============================================================
