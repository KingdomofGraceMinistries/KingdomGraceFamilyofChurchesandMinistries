-- ============================================================
-- 2026-05-30 — point pg_cron at kgfcm-devotion-generate-v2.
--
-- Context: the original kgfcm-devotion-generate slug entered a
-- "stuck" state on the Supabase deploys API where further deploys
-- of that slug returned 500 InternalServerError, even though
-- identical payloads deployed cleanly under a different slug.
-- (Smoke-tested: minimal hello-world deployed under the original
-- slug, but the fixed version of the devotion code refused. Same
-- code deployed cleanly to kgfcm-devotion-generate-v2.)
--
-- The previous cron also had two latent bugs that were caught
-- during this debugging window and fixed in -v2:
--   1. The function's CORS gate rejected Origin-less server-to-
--      server calls (pg_net cron sends no Origin), surfacing as
--      403 "Forbidden origin" — every cron run since 2026-05-15
--      hit this and produced zero rows. Fixed by mirroring the
--      kgfcm-checkin-remind / kgfcm-push-send pattern: only reject
--      when an Origin IS present and unallowed.
--   2. The function called supa.auth.getUser() on the cron's
--      service-role JWT, which only validates user JWTs, yielding
--      401 "Invalid session". Fixed by decoding the JWT (signature
--      already verified by the Functions Gateway because
--      verify_jwt:true) and routing role=service_role calls as
--      trusted server callers.
--
-- Point the cron at -v2 until the original slug recovers (at
-- which point a follow-up migration can either point back or
-- rename -v2 to the canonical name via dashboard).
-- ============================================================

do $$
begin
  if exists (select 1 from cron.job where jobname = 'kgfcm_daily_devotion') then
    perform cron.unschedule('kgfcm_daily_devotion');
  end if;
  perform cron.schedule(
    'kgfcm_daily_devotion',
    '0 10 * * *',
    $cron$
      select net.http_post(
        url := 'https://kseocbwhuveieqhayske.supabase.co/functions/v1/kgfcm-devotion-generate-v2',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'kgfcm_service_role'
            limit 1
          )
        ),
        body := jsonb_build_object('auto_publish', true),
        timeout_milliseconds := 60000
      );
    $cron$
  );
end $$;
