-- ============================================================
-- 2026-11-06 — rf_reset_attempts: allow kind = 'ai'.
--
-- The shared rate limiter (supabase/functions/_shared/rate_limit.ts)
-- now counts each kind only against attempts of the same kind, with
-- its own limits per kind. Before this, the count ignored kind, and
-- kgfcm-ai-proxy recorded its calls as 'login' — so five AI calls in
-- an hour blocked that pastor's next PIN login, and every login and
-- AI call from one address shared a single 20/hour budget. With the
-- whole network (~30 pastors) signing in from one venue's Wi-Fi at
-- launch, the 21st would have been refused.
--
-- AI calls now record as their own kind, which this CHECK must allow.
-- Additive only: every existing value stays valid.
-- ============================================================

alter table public.rf_reset_attempts
  drop constraint if exists rf_reset_attempts_kind_check;

alter table public.rf_reset_attempts
  add constraint rf_reset_attempts_kind_check
  check (kind = any (array['login'::text, 'reset'::text, 'register'::text, 'ai'::text]));
