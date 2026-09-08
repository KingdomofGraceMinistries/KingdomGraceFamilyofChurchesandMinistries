-- ============================================================
-- 2026-09-08 — create_pastor(): let the bishop or an admin add a
-- pastor by name + email, so the PIN can be emailed to them.
--
-- Why this is needed. Until now a row in rf_pastors could only
-- come into existence one way: the pastor themselves opening an
-- invite link and self-registering through kgfcm-pin-register,
-- choosing their own PIN. INSERT on rf_pastors is service_role
-- only at the GRANT layer (see 20260513170000_real_auth.sql, the
-- comment above the rf_pastors grants), so no dashboard action
-- could create one. That left no way for the bishop to onboard a
-- pastor he has an email address for — rf_invites has never held
-- a single row, and the share-link flow is the only path built.
--
-- This RPC is the pastor-side twin of create_admin(), with one
-- deliberate difference: it does NOT take a PIN.
--
--   create_admin(email, name, pin)  — bishop types a starting PIN
--   create_pastor(email, name)      — no PIN parameter at all
--
-- The pastor's credential is minted afterwards by the
-- kgfcm-admin-pin-issue edge function: a CSPRNG 6-digit PIN,
-- bcrypted via hash_pin and emailed straight to the pastor. It is
-- never returned to the caller, never written to rf_audit_log and
-- never rendered in the dashboard. So unlike the Admins tab, the
-- plaintext PIN never exists in the browser and the bishop never
-- has a credential to read aloud or mistype. Keeping the PIN out
-- of this function's signature is what makes that guarantee hold.
--
-- Who may call it. Bishop or admin — deliberately looser than
-- create_admin's bishop-only bar, and matching the bar
-- kgfcm-admin-pin-issue already enforces for pastor_id targets:
-- admins manage pastors today (they can create invites, and could
-- already trigger a pastor PIN reset), so requiring the bishop
-- here would remove a capability they have. Minting a fellow
-- *administrator* remains bishop-only; that is the power that is
-- not delegated.
--
-- The role is read from app_metadata.role directly rather than
-- through is_bishop(). is_bishop() returns the same answer for
-- this pair, but it is a misnomer — it means "is staff" — and
-- spelling the two accepted roles out here keeps the intent
-- legible at the call site instead of hiding it behind a helper
-- whose name says something narrower than it does.
--
-- Status is 'active' on insert, not 'pending'. The bishop's
-- overview queries rf_pastors with status=eq.active, so a pending
-- row would be invisible to the very person who just created it —
-- and if the PIN email failed, nobody could find the pastor to
-- retry. An active row with a null pin_bcrypt cannot be signed
-- into: kgfcm-pin-login's findLoginCandidate requires a non-null
-- pin_bcrypt, so there is no window in which the account is
-- reachable without a credential.
--
-- Duplicate guard covers rf_admins as well as rf_pastors. An
-- email that already belongs to an admin would be shadowed at
-- login — findLoginCandidate checks rf_admins first and returns on
-- the first match — so the pastor row would be created but could
-- never be signed into. Better to refuse with a clear message
-- than to leave an unreachable account behind. The bishop's own
-- address is covered by this check; he holds an rf_admins row.
--
-- The lower(email) comparison is stricter than the uniqueness
-- that exists (rf_pastors_email_key is unique on raw email, not
-- on lower(email)), and every insert here is lowercased, which is
-- also the form kgfcm-pin-login looks up. A mixed-case duplicate
-- is therefore caught by this guard with a readable message
-- rather than by the index with a raw 23505.
-- ============================================================

create or replace function public.create_pastor(
  p_email text,
  p_name  text
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  new_id uuid;
  caller_role text;
begin
  caller_role := coalesce(
    current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'role',
    ''
  );
  if caller_role not in ('bishop', 'admin') then
    raise exception 'forbidden: only the bishop or an admin may add pastors';
  end if;
  if p_email is null or btrim(p_email) = '' then
    raise exception 'email is required';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'name is required';
  end if;
  if exists (select 1 from rf_pastors where lower(email) = lower(btrim(p_email))) then
    raise exception 'a pastor with that email already exists';
  end if;
  if exists (select 1 from rf_admins where lower(email) = lower(btrim(p_email))) then
    raise exception 'that email already belongs to an admin account';
  end if;

  insert into rf_pastors (
    full_name, email, status, role
  ) values (
    btrim(p_name),
    lower(btrim(p_email)),
    'active',
    'pastor'
  )
  returning id into new_id;

  return new_id;
end;
$fn$;

revoke execute on function public.create_pastor(text, text) from public, anon;
grant   execute on function public.create_pastor(text, text) to authenticated, service_role;
