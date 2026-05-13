-- ============================================================
-- 20260412210000 — Consolidated pre-auth schema (SEC-16)
--
-- Captures the schemas that prior sessions applied via the MCP
-- execute_sql / apply_migration path but never saved back as
-- repo files. Without these, a clean `supabase db reset`
-- replay can't reconstruct the production schema.
--
-- Specifically this consolidates the seven orphan migrations:
--   20260408221240 enable_rls_and_policies      (covered by 001)
--   20260408221253 weekly_post_reset_function   (covered by 001)
--   20260408222155 create_audit_log_table       (THIS FILE)
--   20260409035012 add_pin_reset_token          (THIS FILE)
--   20260409040326 create_admins_table          (THIS FILE)
--   20260409041744 create_network_config_with_bishop_pin (THIS FILE)
--   20260412203307 admin_email_and_reset_token  (THIS FILE)
--
-- All statements are idempotent. Auth-era columns (auth_user_id,
-- pin_bcrypt, is_bishop, reset_token_hash) are added by the
-- 20260513170000_real_auth migration which runs after this one,
-- so this file is the "pre-auth ground truth" for replay.
-- ============================================================

-- ── rf_audit_log ─────────────────────────────────────────────
create table if not exists rf_audit_log (
  id            uuid primary key default gen_random_uuid(),
  event_type    text not null,
  actor_id      text not null,
  actor_role    text not null,
  target_table  text,
  target_id     text,
  metadata      jsonb default '{}'::jsonb,
  ip_address    text,
  created_at    timestamptz default now()
);
create index if not exists idx_audit_event   on rf_audit_log(event_type);
create index if not exists idx_audit_actor   on rf_audit_log(actor_id);
create index if not exists idx_audit_created on rf_audit_log(created_at desc);
alter table rf_audit_log enable row level security;
-- RLS policies for rf_audit_log are installed by 20260513170000_real_auth
-- (bishop-only SELECT; no client INSERT — server-side only via edge fns).

-- ── rf_admins ────────────────────────────────────────────────
create table if not exists rf_admins (
  id                  uuid primary key default gen_random_uuid(),
  full_name           text not null,
  pin_hash            text not null,
  permissions         text[] default '{invites,messages,pastors,announcements}',
  status              text default 'active',
  created_at          timestamptz default now(),
  email               text,
  reset_token         text,
  reset_token_expires timestamptz
);
create unique index if not exists uq_admins_email on rf_admins(email) where email is not null;
alter table rf_admins enable row level security;

-- ── rf_network_config ────────────────────────────────────────
create table if not exists rf_network_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz default now()
);
alter table rf_network_config enable row level security;

-- ── pin_reset_token columns on rf_pastors ────────────────────
-- The original 001 migration didn't include these; they were added later.
alter table rf_pastors
  add column if not exists reset_token         text,
  add column if not exists reset_token_expires timestamptz;

-- ── Branding bootstrap (kept here because subsequent migrations
--    rely on these rows existing). Values are tenant-specific —
--    edit before applying to a different organization.
insert into rf_network_config (key, value) values
  ('network_name',  'Kingdom Grace Family of Churches and Ministries'),
  ('network_short', 'Kingdom Grace'),
  ('app_id',        'kgfcm'),
  ('bishop_name',   'Bishop Peter Sasser')
on conflict (key) do nothing;
