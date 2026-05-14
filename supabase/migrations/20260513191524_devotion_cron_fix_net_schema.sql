-- pg_net exposes functions in the `net` schema, not `extensions`. Re-schedule.
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
        body := jsonb_build_object('auto_publish', true),
        timeout_milliseconds := 60000
      );
    $cron$
  );
end $$;
SELECT jobname, schedule FROM cron.job WHERE jobname = 'kgfcm_daily_devotion';
