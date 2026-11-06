-- ============================================================
-- 2026-11-06 — the daily devotion cron uses the secret key, not the
-- legacy service_role JWT.
--
-- Supabase retires the legacy JWT-based anon/service_role keys at the
-- end of 2026. Server callers now present a secret key (sb_secret_…)
-- on the `apikey` header only — on `Authorization: Bearer` the platform
-- parses it as a JWT and rejects it — and kgfcm-devotion-generate-v2
-- (verify_jwt = false) checks it in code against SUPABASE_SECRET_KEYS.
--
-- Prerequisite: vault secret 'kgfcm_secret_key' holding the project's
-- default secret key. It is created out of band — a secret value never
-- goes in a migration file. This migration refuses to run without it,
-- so the cron can never be left pointing at a missing secret.
--
-- The legacy vault secret 'kgfcm_service_role' is removed: after this
-- nothing reads it, and keeping a service_role JWT around would block
-- deactivating the legacy keys.
-- ============================================================

do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'kgfcm_secret_key' and decrypted_secret like 'sb\_secret\_%'
  ) then
    raise exception 'vault secret kgfcm_secret_key (an sb_secret_ key) must exist before this migration';
  end if;

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
          'Content-Type', 'application/json',
          'apikey', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'kgfcm_secret_key'
            limit 1
          )
        ),
        body := jsonb_build_object('auto_publish', true),
        timeout_milliseconds := 60000
      );
    $cron$
  );
end $$;

delete from vault.secrets where name = 'kgfcm_service_role';
