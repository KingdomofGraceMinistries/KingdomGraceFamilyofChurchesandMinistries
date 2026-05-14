-- ============================================================
-- Devotion auto-publish cron + edit-modal grants
-- ============================================================

-- Enable pg_net so cron jobs can make HTTP calls.
create extension if not exists pg_net with schema extensions;

-- Extend the UPDATE GRANT on rf_devotions to include the fields the bishop
-- needs to fix in the edit modal: theme, scripture_ref, scripture_text,
-- and source (so bishop hand-edits flip source -> 'bishop').
grant update (status, title, theme, scripture_ref, scripture_text, body,
              reflection_prompt, prophetic_call, audio_url, video_url,
              source, reviewed_by, published_at)
  on rf_devotions to authenticated;

-- Re-schedule the daily devotion cron. Picks up tomorrow at 10:00 UTC
-- (~5am US Central) and every day thereafter. Auth via the project's
-- service_role JWT stored in vault under the name 'kgfcm_service_role'.
-- (See PROJECT_STATE.md for the one-time vault setup the user runs.)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'kgfcm_daily_devotion') then
    perform cron.unschedule('kgfcm_daily_devotion');
  end if;
  perform cron.schedule(
    'kgfcm_daily_devotion',
    '0 10 * * *',
    $cron$
      select extensions.http_post(
        url := 'https://kseocbwhuveieqhayske.supabase.co/functions/v1/kgfcm-devotion-generate',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'kgfcm_service_role'
            limit 1
          )
        ),
        body := jsonb_build_object('auto_publish', true)::text,
        timeout_milliseconds := 60000
      );
    $cron$
  );
end $$;
