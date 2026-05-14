-- ============================================================
-- Bishop-configurable fallback content for the home screen
--
-- When the AI is unavailable or returns junk, the home/team screens
-- need to render SOMETHING — but theological content must never be
-- hardcoded in the app. Source of truth is rf_network_config, which
-- the Bishop already controls.
--
-- Two new keys:
--   default_week_prompt — JSON with {prompt, scripture, ref, theme}
--   default_month_challenge — JSON with {title, goal, action, scripture, ref}
--
-- Rows are seeded EMPTY (null JSON). When Bishop populates them via
-- the SQL Editor or a future admin UI, the home screen begins
-- falling back to those values when the AI path fails.
-- ============================================================

insert into rf_network_config (key, value) values
  ('default_week_prompt',     ''),
  ('default_month_challenge', '')
on conflict (key) do nothing;
