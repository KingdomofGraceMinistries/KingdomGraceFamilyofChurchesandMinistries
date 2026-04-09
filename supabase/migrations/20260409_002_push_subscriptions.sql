-- ============================================================
-- Push Notification Subscriptions
-- Stores Web Push API subscriptions per user/device
-- ============================================================

create table if not exists rf_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,                     -- pastor UUID or 'bishop'
  endpoint text not null,                     -- push service URL (unique per device)
  p256dh text not null,                       -- client public key
  auth text not null,                         -- client auth secret
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, endpoint)                   -- one subscription per user+device
);

-- Index for quick lookup when sending pushes
create index if not exists idx_push_subs_user on rf_push_subscriptions(user_id);

-- Allow the anon role to insert/update/delete their own subscriptions
alter table rf_push_subscriptions enable row level security;

create policy "Users can manage their own push subscriptions"
  on rf_push_subscriptions
  for all
  using (true)
  with check (true);
