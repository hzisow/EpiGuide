-- apns_tokens — APNs device tokens for the native iOS shell.
--
-- NOT YET APPLIED. Run this only once the Apple Developer enrolment is done and
-- you are ready to turn on APNS_ENABLED in js/native.js:
--     supabase db push          (or paste into the SQL editor)
--
-- Why a separate table instead of reusing push_subscriptions:
--   push_subscriptions is web-push shaped — (endpoint, p256dh, auth), all NOT
--   NULL — and describes a *browser* subscription with its own ECDH keypair.
--   An APNs device token is a single opaque hex string with no endpoint URL and
--   no keys. Forcing it in would mean nullable columns and sentinel values on a
--   table the web push path depends on. Keeping them separate also means the
--   notify-responders fan-out can tell the two transports apart, which it must:
--   they use completely different protocols.
--
-- RLS policy below deliberately mirrors the existing `push_subscriptions_own`
-- policy verbatim (FOR ALL TO authenticated, USING/WITH CHECK user_id =
-- auth.uid()), which is the convention every user-owned table in this project
-- follows (responder_locations_own is identical). The notify-responders Edge
-- Function reads this table with the service role key, which bypasses RLS.

create table if not exists public.apns_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- The APNs device token, uppercase hex. Unique across users: one physical
  -- device has exactly one token per app, so this is the natural upsert key
  -- (js/net.js saveApnsToken upserts on it), mirroring how push_subscriptions
  -- is unique on `endpoint`.
  device_token text not null unique,
  -- 'ios' today. Present so an Android/FCM shell can share this table later
  -- rather than needing a third one.
  platform     text not null default 'ios',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- The fan-out selects by the set of nearby responder user_ids.
create index if not exists apns_tokens_user_id_idx on public.apns_tokens (user_id);

alter table public.apns_tokens enable row level security;

-- Owner-only, identical in shape to push_subscriptions_own.
drop policy if exists apns_tokens_own on public.apns_tokens;
create policy apns_tokens_own on public.apns_tokens
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- KNOWN EDGE CASE (inherited from push_subscriptions, same root cause):
-- if user A signs out on a device and user B signs in on that SAME device, B's
-- upsert conflicts on device_token against a row A owns. The USING clause is
-- evaluated against the existing row, so the update is rejected and the token
-- stays mapped to A. The practical effect is that B gets no closed-app alerts
-- until the row is cleared. Two ways out if this ever matters in practice:
--   (a) have the app delete its own row on sign-out (RLS permits that: the row
--       still belongs to the user who is signing out), or
--   (b) move the upsert into a security-definer RPC that reassigns user_id.
-- Not doing either now — this is single-user-per-device in practice, and (a)
-- is a client change that belongs with whatever ships sign-out cleanup.
