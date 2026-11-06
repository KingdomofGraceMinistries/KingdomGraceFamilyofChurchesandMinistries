-- ============================================================
-- 2026-11-06 — push subscriptions: one person per device.
--
-- rf_push_subscriptions was unique on (user_id, endpoint), so one
-- browser could be registered to several people at once. Read on
-- 2026-11-06: one device held the bishop + an admin, another the
-- test pastor + the bishop + an admin. Pushes were not reaching
-- anyone then (kgfcm-push-notify addressed profile ids, not
-- auth ids), so nothing leaked — but once recipients resolve
-- correctly, the bishop's DMs would arrive on a device a pastor
-- had last used. Sign-out now removes the device's row, but a row
-- left behind by an earlier sign-out, or a device that changes
-- hands without one, would still collect them.
--
-- A push endpoint is one browser profile. It now belongs to one
-- person: whoever most recently turned notifications on there.
--
-- register_push_device() does the hand-over. It runs as definer
-- because removing the previous holder's row is exactly what a
-- caller's own RLS (user_id = auth.uid()) cannot do. It acts only
-- on the endpoint the caller presents — a capability URL that only
-- that browser knows — and always assigns it to auth.uid(), never
-- to a caller-supplied id.
--
-- Also removes the two pre-auth rows stored under the literal
-- user_id 'bishop' (2026-04-09 / 04-12). Nothing resolves to that
-- id any more; the bishop's current devices are under his auth id.
-- The bishop's PIN login does not read this table.
-- ============================================================

-- Pre-auth leftovers.
delete from public.rf_push_subscriptions where user_id = 'bishop';

-- Keep only the most recent holder of each endpoint.
delete from public.rf_push_subscriptions s
using public.rf_push_subscriptions newer
where s.endpoint = newer.endpoint
  and (coalesce(newer.updated_at, newer.created_at), newer.id)
    > (coalesce(s.updated_at, s.created_at), s.id);

alter table public.rf_push_subscriptions
  drop constraint if exists rf_push_subscriptions_user_id_endpoint_key;
alter table public.rf_push_subscriptions
  add constraint rf_push_subscriptions_endpoint_key unique (endpoint);

create or replace function public.register_push_device(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  uid text := auth.uid()::text;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' then
    raise exception 'invalid push endpoint';
  end if;
  if coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'missing push keys';
  end if;

  insert into rf_push_subscriptions (user_id, endpoint, p256dh, auth, updated_at)
  values (uid, p_endpoint, p_p256dh, p_auth, now())
  on conflict (endpoint) do update
    set user_id    = excluded.user_id,
        p256dh     = excluded.p256dh,
        auth       = excluded.auth,
        updated_at = now();
end;
$$;

revoke all on function public.register_push_device(text, text, text) from public, anon;
grant execute on function public.register_push_device(text, text, text) to authenticated;
