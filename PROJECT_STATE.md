# Kingdom Grace Pastoral Network — Project State

**Last updated:** 2026-08-14
**Status:** In production — security remediation in progress (see tracker below)
**Client:** Kingdom Grace Family of Churches and Ministries
**Built by:** Envision VirtualEdge Group LLC

---

## 🔭 NEXT UP — white-label + platform/app views (opened 2026-08-14)

Two directives from the 2026-08-14 session. Nothing below is started; each item
records what was actually inspected so the next session does not re-derive it.

### A. White-label — nothing hardcoded

**Client is effectively done.** `kg-pastoral-network.html` resolves 25 branding
keys from `rf_network_config` (`network_name`, `network_short`, `bishop_name`,
`bishop_title`, `bishop_photo_url`, `bishop_bio`, `apostle_*`, `couple_*`,
`logo_url`, `tagline`, `est_line`, `themes`, `footer_*`, `app_id`,
`ai_proxy_fn`, `push_notify_fn`, `vapid_public_key`). The last two literal
bishop names were removed in `bde7bb6`; no occurrence remains in displayed text.

**Edge functions are NOT.** Compiled-in strings, in priority order:

| # | Location | Hardcoded | Why it matters |
|---|---|---|---|
| A1 | `kgfcm-devotion-generate-v2/index.ts:368` (`SYSTEM_PROMPT`) | Network name **and** "a network of Black-church pastoral leaders" | **Highest value.** Carries this network's identity and theological voice. A second tenant would silently generate devotions written for Kingdom Grace. This is Rule #12 territory — theology in a `const`. Belongs in `rf_network_config`, authored per bishop. |
| A2 | `kgfcm-devotion-generate-v2/index.ts:258` | Network name in the user prompt | Same fix, same migration. |
| A3 | `kgfcm-checkin-remind/index.ts:56` | "Your Kingdom Grace family hasn't heard from you in a while…" | Push body sent to every overdue pastor. |
| A4 | `kgfcm-pin-reset/index.ts:29`, `kgfcm-admin-pin-issue/index.ts:51` | `RESEND_FROM` default `Kingdom Grace <noreply@kingdomgracefamily.com>` | Env-overridable, so lower risk, but the default is branded. |

> **Do A1/A2 together.** Keep the existing prompt as the seeded value for this
> network so behaviour does not change on deploy — the full prompt is
> load-bearing (see the 2026-08-14 note in `REFORMATION_ROADMAP.md`: a
> condensed rewrite had dropped the entire orthodoxy definition).

**A5 — tenancy model, needs an architectural decision first.** Function slugs are
`kgfcm-*` and `C.appId` is `kgfcm`. True multi-tenant means either one shared
deployment keyed by tenant, or one Supabase project per tenant. Not a
find-and-replace. Decide before touching slugs.

### B. Desktop = platform view, mobile = app view

**Already in place** (shipped `54feea7`): `#app` is a 430px phone column
(`:46`); at `@media (min-width:1024px)` it widens to 1080px (`:109`), standard
screens keep a 680px readable column, and the prayer/wins/announcements/team
feeds become a `repeat(auto-fill,minmax(280px,1fr))` grid. The bishop dashboard
already has its own `768px` / `480px` handling (`:365`, `:386`). Breakpoints
currently defined: 500, 1024, and dashboard-side 600/768/480.

**SCOPE DECISION (2026-08-14):** platform chrome applies to the **pastor app
only**. The bishop dashboard stays exactly as it is.

| In scope | Out of scope |
|---|---|
| `#app` (`:46`) — the 430px phone column | `#bishop-app` (`:150`) |
| `.screen` (`:142`), `.scroll` (`:145`) | `.b-topbar` (`:154`), `.b-nav` (`:159`), `.b-tab` (`:160`) |
| `.tnav*` (`:237`–`:242`) — the pastor top nav | `.b-body` (`:164`), `.b-panel` (`:165`) |
| The `@media (min-width:1024px)` block at `:108` | The dashboard's own `768`/`480` blocks (`:365`, `:386`) |

Do not touch any `.b-*` rule or `#bishop-app`. The dashboard is already a
full-viewport desktop layout with its own responsive handling and is not part of
this work.

**What is missing:** the pastor app on desktop still reads as a *widened phone*,
not a platform. To close that:

- Persistent **side navigation** on `≥1024px` replacing the `.tnav` top bar,
  driven by the same `go()` screen switching so navigation logic is unchanged
- Genuine multi-column layouts within a screen (list + detail side by side —
  e.g. the DM thread list beside the conversation)
- Desktop typography and spacing scale
- Keep everything `<1024px` byte-identical to today — the phone experience *is*
  the app view and must not regress

Because the pastor app and the dashboard are separate shells (`#app` vs
`#bishop-app`, toggled in `launchBishopDashboard()` / `bishopViewApp()`), this
is a contained change: it does not rewrite the navigation model, and a bishop
viewing the pastor app gets the same platform chrome any pastor does.

> **Caution:** this touches every screen's layout in a single 5,600-line file.
> Start it fresh, not at the end of a long session. Verify by loading the page
> at 390px, 768px, 1280px and 1920px before committing.

### C. Carried over from 2026-08-14 — small, unblocked

- **`SB_SECRET_KEY` holds a `sb_publishable_` key.** Dashboard fix: set it to a
  genuine `sb_secret_…` key. Keep **both** it and `SUPABASE_SERVICE_ROLE_KEY`
  populated — the two-key fallback is intended and stays until the legacy model
  is fully retired. See `REFORMATION_ROADMAP.md` I1.
- **`pg_net` cron still on a legacy JWT.** Vault secret `kgfcm_service_role` is
  a legacy JWT (219 chars). Not a value swap: `kgfcm-devotion-generate-v2`
  identifies the cron by *decoding* that bearer (`claims.role === 'service_role'`),
  so an opaque key fails `decodeJwtClaims` and hits the `Invalid JWT` 401. Needs
  an auth redesign — own session.
- **Delete the `kgfcm-deploy-smoke-test` function.** Retired to a 410 stub; reads
  nothing from the environment. Safe to remove from the dashboard.
- **Gladys Bowden-Brown** (`ladyofpraize@hotmail.com`) is provisioned and active
  but has never signed in (`auth_user_id` null). Bishop taps **Email PIN** in the
  Admins tab and she receives working 6 digits.
- **Admins tab discoverability.** It is 10th of 12 in a horizontally scrolling
  strip on mobile with only a 2px scrollbar as a cue. Worth a scroll affordance.

---

## 🚨 SECURITY REMEDIATION TRACKER (opened 2026-05-13)

Prior sessions shipped placeholder security code (`btoa()` as "hash", `Math.random()`
for reset codes, anon-open RLS, `console.error` in edge functions, `--no-verify-jwt`
deploys, `Access-Control-Allow-Origin: *`, reset codes echoed back to the browser).
The user has rejected the "MVP acceptable" framing — this is a production pastoral
network handling confessional data and every item below is required, not optional.

Hard-block hooks now installed at `.claude/settings.json` to prevent regression
(see `.claude/hooks/` and `memory/feedback_no_demo_grade_code.md`).

| # | Item | Priority | Status | Notes |
|---|------|----------|--------|-------|
| SEC-1 | Replace `btoa(pin)` with real server-side PIN hashing (bcrypt) | CRITICAL | **DONE 2026-05-13** | Migration `20260513170000_real_auth.sql`; pgcrypto bcrypt; `verify_pin` / `hash_pin` SECURITY DEFINER RPCs grantable only to service_role; column-level GRANT keeps `pin_bcrypt` unreadable by authenticated. |
| SEC-2 | Replace `Math.random()` reset codes + `btoa(...)` invite tokens with CSPRNG | **DONE 2026-05-13** | Final HTML grep returns zero Math.random / security-context btoa. Reset codes now generated by `kgfcm-pin-reset` via `generateCode()` (CSPRNG, 8 hex chars). Invite tokens via `crypto.randomUUID()`. Admin creation `pin_hash: btoa(pin)` replaced by `create_admin()` SECURITY DEFINER RPC with bcrypt. (Remaining `btoa()` in HTML is the WebAuthn credential.rawId base64 encoding — legitimate bytes-to-text use.) |
| SEC-3 | Tighten RLS — remove `anon using(true)/with check(true)`, require JWT | CRITICAL | **DONE 2026-05-13** | All old `using(true)` anon policies dropped. New policies key on `auth.uid()` and `is_bishop()` (JWT app_metadata.role). Column-level GRANT excludes pin_bcrypt + reset_token_hash. Post-migration assertion: zero open anon writes remain. |
| SEC-4 | Email/SMS delivery for reset codes — stop echoing to browser | **DONE 2026-05-13** | Two new edge functions: `kgfcm-pin-reset` (sends 8-char CSPRNG code via Resend, stores SHA-256 hash in `reset_token_hash`, constant-time `{sent:true}` response regardless of email-existence — enumeration defense) and `kgfcm-pin-reset-confirm` (verifies hash, bcrypts new PIN, issues session for auto-login). Bishop's reset-pastor/reset-admin buttons now trigger the same email flow; bishop never sees a code. Code never echoes to the browser. **Action: set `RESEND_API_KEY` and `RESEND_FROM` Supabase secrets** for delivery; without them the function still hashes and stores correctly but the email send is a no-op (audited as `delivered:false`). |
| SEC-5 | JWT-verify all edge functions, lock CORS to production origin | **DONE 2026-05-13** | All 4 legacy fns (kgfcm-ai-proxy, kgfcm-push-send, kgfcm-push-notify, kgfcm-checkin-remind) redeployed with `verify_jwt: true` and the shared CORS module. Unauthenticated calls now rejected by Supabase's edge runtime before our code runs. kgfcm-push-send accepts service_role (server-to-server) or bishop/admin JWT only; rejects pastor JWT with audit log. kgfcm-ai-proxy rate-limits per user via rf_reset_attempts. Login/register kept `verify_jwt: false` (PIN flow has no JWT yet) but do their own rate-limit + constant-time. Lock CORS to production by setting `ALLOWED_ORIGINS` Supabase env var to the Vercel domain. |
| SEC-6 | Server-side audit logger via service-role edge function | **DONE 2026-05-13** | New kgfcm-audit edge function deployed (verify_jwt: true). Client `audit()` in HTML routes through it; actor_id/actor_role come from the verified JWT, not client claim. All 5 `console.error` calls in legacy fns replaced with `audit()`. Verified: SMOKE_TEST audit row from bishop JWT recorded `actor_role: bishop` server-derived. |
| SEC-7 | Add CSP header in vercel.json | **DONE 2026-05-13** | Strict CSP with default-src 'self', script-src 'self' 'unsafe-inline' (HTML has inline scripts + onclick handlers), style-src + font-src for Google Fonts, img-src + connect-src locked to the project's Supabase domain, frame-ancestors 'none', upgrade-insecure-requests. Plus HSTS (Strict-Transport-Security: max-age=63072000 includeSubDomains preload). |
| SEC-8 | Remove redundant long-lived anon JWT from HTML | **DONE 2026-05-13** | Legacy `supabaseAnonKey` removed from kg-pastoral-network.html config block; `supabaseKey` getter + `SB_API_KEY` simplified to publishable key only. One fewer long-lived secret in the bundle. |
| SEC-9 | Migrate `image_data` base64 columns to storage bucket | **DONE 2026-05-13** | Migration 20260513180000 renames `image_data` → `image_url` on rf_wins and rf_announcements (zero rows had non-null image_data — pure rename, no data carry). HTML uses the new name. Already wrote bucket URLs into the column; now the column name matches reality. |
| SEC-10 | Idempotency keys on offline-queue mutations | **DONE 2026-05-13** | HTML `SB_HDR` attaches a fresh `Idempotency-Key: <crypto.randomUUID()>` on every mutation. sw.js preserves the header on queue and tracks completed keys in IndexedDB v2 `processed_keys` store; replays skip keys already acknowledged. Prevents the "server accepted but client lost the response" dup case. |
| SEC-11 | Wire `.githooks/pre-commit` — set `core.hooksPath` (USER ACTION) | OPEN | Run `git config core.hooksPath .githooks` once. |
| SEC-12 | Reload Claude hooks via `/hooks` (USER ACTION) | **DONE** | Hooks have been firing throughout the session (caught CORS-wildcard, SQL-anon, and HEREDOC false positives along the way — all refined). |
| SEC-13 | rf_push_subscriptions ALL policy wide-open to `public` | **DONE 2026-05-13** | Replaced with self-only CRUD keyed on `user_id = auth.uid()::text`. Bishop can read all via `is_bishop()`. |
| SEC-14 | reset_weekly_post_counts SECURITY DEFINER + anon-executable + mutable search_path | **DONE 2026-05-13** | EXECUTE revoked from anon/authenticated/public; search_path pinned to `public, pg_temp`. |
| SEC-15 | Public bucket SELECT-list policies | **DONE 2026-05-13** | `wins_public_read`, `voice_public_read`, `public_read_avatars`, `public_read_announcements` dropped. Direct URL fetch still works; bucket enumeration does not. |
| SEC-16 | Capture orphan MCP-applied migrations as files | **DONE 2026-05-13** | `20260412210000_consolidated_pre_auth.sql` captures the schema for rf_audit_log, rf_admins, rf_network_config plus the rf_pastors.reset_token columns. Idempotent (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / ON CONFLICT DO NOTHING). A fresh `supabase db reset` against the repo migrations now reconstructs the live schema. |

### Phase 1 — what shipped on 2026-05-13

- Migration `20260513170000_real_auth.sql` applied (live).
- Edge functions deployed: `kgfcm-pin-login` (v2), `kgfcm-pin-register` (v1).
- HTML cutover: `SB_HDR` uses session JWT; `submitPin`/`registerPastor` now call edge functions; `select:'*'` on rf_pastors replaced with `select:PASTOR_COLS` (excludes pin_bcrypt + reset_token_hash); top-level `window.error` + `unhandledrejection` boundary; magic-link login + magic-link callback handler on app boot; `LAST_EMAIL_KEY` remembered per-device.
- Bishop bootstrap: `bishop_email = 'BishopSasser2015@gmail.com'`, bcrypt PIN preserved (`101010`), `rf_admins` profile row created on first verified login. End-to-end smoke test via curl returned a valid bishop JWT.
- Auth boundary now requires email + PIN (or magic link). The bishop's "Bishop Access" entry shows the same screen as pastor/admin — email pre-filled from `localStorage[LAST_EMAIL_KEY]`.

In-session TaskList mirrors this table.

---

## 🕊️ Reformation Feature Tracker

See `REFORMATION_ROADMAP.md` for the full list with scope/rationale.

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | Doctrinal Statement / Core Beliefs page | PHASE 2 | Smallest and most symbolic — do first in phase 2. Bishop drafts text first. |
| 2 | Teaching Library (sermons, Bible study, position papers) | PHASE 2 | Reuses `voice` bucket; add `rf_teachings` table |
| 3 | Fasting / Consecration Tracker | DONE (2026-04-12) | `rf_fasts` + `rf_fast_participants`, home card, declare/join/breakthrough |
| 4 | Ordination / Credentialing Tracker | DONE (2026-04-12) | Added columns on `rf_pastors`; edit in profile; display on pastor view |
| 5 | Church Directory | LATER | Promote `rf_pastors.church_name` to proper `rf_churches` table |
| 6 | Events / Calendar | DONE (2026-04-12) | `rf_events` + home card + `s-events` screen with bishop compose |
| 7 | Testimony Wall (long-form testimonies) | PHASE 2 | Separate from Wins — storytelling, reuse voice bucket |
| 8 | Apostles' Council Voting | PHASE 2 | Already a Coming Soon button on home |

**Phase 2 build order** (after Bishop Sasser uses v1 for 1–2 weeks and gives real feedback):
1. Doctrinal Statement
2. Teaching Library
3. Church Directory
4. Testimony Wall
5. Apostles' Council Voting

---

---

## ✅ RESUME HERE — SUPERSEDED 2026-08-14 (kept for history)

> **This section is out of date.** The MCP OAuth issue it describes is resolved —
> the project-scoped Supabase connector authenticates and was used throughout the
> 2026-08-14 session to read the schema, apply migrations, and deploy functions.
> The commit referenced below is long superseded. For current work see
> **NEXT UP — white-label + platform/app views** at the top of this file.

All HTML/JS/SQL changes are **written and pushed**. Latest commit: `f795974`.
Everything that's left is **Supabase-side execution** that the previous session
could not run because the `claude.ai Supabase` MCP connector had a stale OAuth
token. A new project-scoped MCP server was added to `.mcp.json` right before
the session restart — it points at the Kingdom Grace project directly:

    project_ref = kseocbwhuveieqhayske

### On first boot of the new session:

1. Run `/mcp`, select **supabase**, complete the browser OAuth once.
2. Confirm via ToolSearch that `mcp__supabase__execute_sql`,
   `mcp__supabase__apply_migration`, and `mcp__supabase__deploy_edge_function`
   (or similarly named real tools) are now available.
3. Then execute, in order:

   a. **Apply the migration** — contents of
      `supabase/migrations/20260412_003_wins_images_outreach.sql`
      (adds `rf_wins.image_data`, creates `rf_outreach_profiles` + RLS).

   b. **Create the `wins` storage bucket and its RLS policies** — the SQL is
      in Section 2 of `supabase/RUN_THIS_IN_SUPABASE.sql`.

   c. **Upsert the photo URLs** into `rf_network_config` (Section 3 of
      `RUN_THIS_IN_SUPABASE.sql`):
        - `bishop_photo_url`  → `/Bishop%20Sasser.jpg`
        - `apostle_photo_url` → `/Bishop%20Sasser%20and%20Eraka.jpg`
        - `couple_photo_url`  → `/Bishop%20and%20Apostle.jpg`

   d. **Upsert the warmer theme JSON** into `rf_network_config.themes`
      (Section 4 of `RUN_THIS_IN_SUPABASE.sql` — the "Parchment" cream
      palette replacing the too-bright beige).

   e. **Deploy the AI proxy edge function** so the new `outreach` callType
      becomes live. The updated source is already in
      `supabase/functions/kgfcm-ai-proxy/index.ts`. Use
      `mcp__supabase__deploy_edge_function` or, if it's easier,
      `npx supabase functions deploy kgfcm-ai-proxy --no-verify-jwt`.

4. Smoke test: open the Vercel-deployed URL, bishop login, tap View App,
   open Outreach Insights, enter a city + demographics, tap Generate.
   Post a Win with a photo. Open the Bishop Profile and confirm the
   couple photo shows in full with no chopped heads.

5. Report the handoff URL to the user so they can forward to Bishop Sasser.

### What is already done (no action needed)

- All HTML / JS changes (commits `21f3d1b`, `9ce7fd0`, `f795974`)
- Photo files are committed to the repo root; Vercel serves them
- `supabase/RUN_THIS_IN_SUPABASE.sql` contains every SQL statement needed
- `.mcp.json` (project-scoped supabase MCP server) — commit it if desired

---

## Current Session (2026-04-12) — SHIP-DAY PUNCH LIST — DONE

- [x] **Fix couples section photo cropping** — switched to `object-fit: contain` with taller max-height so full portraits show. Commit `21f3d1b`.
- [x] **Apostle page photo** — circle avatar replaced with rectangular hero frame on both dashboard and pastor-facing screens. Commit `21f3d1b`.
- [x] **App-screen visual outline** — responsive frame with border/shadow/rounded corners on tablet+ widths. Commit `21f3d1b`.
- [x] **Warmer light (beige) theme** — new "Parchment" palette shipped in `supabase/RUN_THIS_IN_SUPABASE.sql`.
- [x] **Win Wall photo upload** — `image_data` column, photo picker, upload via storage bucket, rendering on both pastor and bishop wins feeds. Commit `9ce7fd0`.
- [x] **Giving button (Coming Soon)** — pastor home tile. Commit `9ce7fd0`.
- [x] **Apostles' Council button (Coming Soon)** — pastor home tile. Commit `9ce7fd0`.
- [x] **Outreach Suggester** — `s-outreach` screen, city/demographics setup, prophetic AI generation with strict guardrails, stored in `rf_outreach_profiles`. Commit `9ce7fd0`.
- [x] **Photo URLs** — committed to repo root; `rf_network_config` updates included in `RUN_THIS_IN_SUPABASE.sql`.

### Ship-day handoff checklist

1. Run `supabase/RUN_THIS_IN_SUPABASE.sql` in the Supabase SQL Editor (applies migration, photo URLs, warm theme, wins storage bucket).
2. Redeploy AI proxy so the new `outreach` callType is live:
   `npx supabase functions deploy kgfcm-ai-proxy --no-verify-jwt`
3. Wait for Vercel to finish building `9ce7fd0` (or the most recent push).
4. Hard-reload the app (Cmd/Ctrl + Shift + R) to clear the service worker cache.
5. Quick smoke test: Bishop login → View App → Outreach Insights → Generate a first set of suggestions → Wins Wall → post a win with a photo.

---

## Session 3 (2026-04-10) — DONE

### Priority Tasks

- [x] **Bishop Profile Page** — Dedicated page for Bishop Peter Sasser with photo, bio, and couple photo. Accessible from dashboard (Bishop tab) and pastor home screen (Leadership section).

- [x] **Apostle Eraka Sasser Page** — Dedicated page for Apostle Eraka Sasser with photo and bio. Same style as Bishop's page. Accessible from dashboard (Apostle Eraka tab) and pastor home screen.

- [x] **Blast Message Branding** — Changed to **"From the Desk of the Bishop"** across:
  - Home screen blast display
  - Push notification title (edge function redeployed)
  - Bishop compose area

### Notes

- Bishop: Peter Sasser
- Wife: Apostle Eraka Sasser
- Will need: photos of Bishop, Apostle Eraka, and a photo of them together
- Bio text for both — ask user to provide or draft from available info

---

## App Summary

A mobile-first PWA for pastoral oversight. Two interfaces:
- **Pastors** — check-ins, prayer wall, wins, team devotionals, messaging, announcements
- **Bishop (Peter Sasser)** — full dashboard with burnout tracking, moderation, engagement analytics, invites, blast messaging

**Tech:** Single HTML file + Supabase (PostgreSQL + Edge Functions) + Claude Haiku AI + Vercel hosting

---

## Completion Tracker

### DONE — Original Build (2026-04-08)

| Feature | Status | Notes |
|---------|--------|-------|
| Pastor authentication (biometric + PIN) | DONE | WebAuthn + 6-digit PIN fallback |
| Weekly check-ins (pulse 1-5 + notes) | DONE | Stores to rf_checkins |
| Prayer wall (post, pray, encourage) | DONE | rf_prayer_requests |
| Wins wall (post, fire/glory reactions) | DONE | rf_wins |
| Team discussion (weekly AI prompts) | DONE | rf_team_responses |
| Announcements (post, image, pin) | DONE | rf_announcements with base64 images |
| Pastor-to-Bishop DMs | DONE | rf_direct_messages |
| Pastor profile (avatar, gifts, bio) | DONE | Full profile management |
| Bishop dashboard overview | DONE | Burnout scores, pastor grid |
| Bishop moderation (prayer/wins/announcements) | DONE | Pin, delete, respond, mark answered |
| Bishop pastor drill-down | DONE | Detailed view with history |
| Bishop invite system | DONE | Token generation + status tracking |
| Bishop blast messaging | DONE | Send + pastors can now read blasts on home screen |
| Engagement charts (real data) | DONE | Queries rf_checkins + posts by week |
| Offline support (service worker) | DONE | Cache-first app shell + IndexedDB mutation queue |
| PWA manifest + icons | DONE | SVG icons + real logo JPG, standalone display |
| Supabase key fallback (publishable → anon) | DONE | Future-proofed for key migration |
| Footer (Envision VirtualEdge) | DONE | Both pastor and bishop views |
| Database migration SQL | DONE | 9 tables + indexes + RLS + weekly reset function |
| AI proxy edge function | DONE | Claude Haiku, 3 call types (care/team/default) |
| RLS policies | DONE | All 9 tables covered |
| vercel.json (routing + headers) | DONE | Security headers + SW support |
| package.json | DONE | Metadata + local dev server |

### DONE — Session 2 (2026-04-09)

| Feature | Status | Notes |
|---------|--------|-------|
| **Bug Fixes & Code Quality** | | |
| XSS fix — `esc()` HTML escaper | DONE | Fixed 30+ innerHTML calls |
| 3 stub functions implemented | DONE | encouragePrayer, bishopPrayFor, bishopCelebrate |
| Error feedback on silent catch blocks | DONE | 11+ catch blocks now show toast |
| Removed console.log from production | PARTIAL — REVERTED CLAIM | Client-side console.log removed, but 5 `console.error` calls remain in edge functions (kgfcm-ai-proxy, push-send, push-notify, checkin-remind). Tracked as SEC-6. |
| **Notification System** | | |
| In-app toast notifications + badge counts | DONE | Visual notification system |
| Notification sound (Web Audio API chime) | DONE | Audio feedback |
| Browser Notification API | DONE | Works when tab not focused |
| 30-second polling for new content | DONE | DMs, prayers, announcements, blasts |
| VAPID push notifications | DONE | Works when app is fully closed |
| Service worker push + click handlers | DONE | sw.js updated |
| Edge Functions: push-send, push-notify | DONE | Deployed to Supabase |
| Edge Function: checkin-remind | DONE | Automated check-in reminders |
| Push subscriptions migration | DONE | 20260409_002_push_subscriptions.sql |
| **High Priority Features** | | |
| Forgot PIN / PIN reset flow | DONE | Pastor + bishop-triggered reset |
| Search across all content | DONE | Prayers, wins, messages, announcements, pastors |
| Read receipts on DMs | DONE | Single check = sent, double gold = read |
| Automated check-in reminders | DONE | Edge Function + overdue badges |
| **Admin & Onboarding** | | |
| Admin role with separate PIN login | DONE | Restricted dashboard access |
| Simplified invite flow | DONE | Name → create → send via text/share/copy |
| Simplified pastor registration | DONE | Link → name + email + PIN → done |
| Login help dropdown | DONE | Explains all three roles |
| **White Label** | | |
| Branding in Supabase rf_network_config | DONE | All branding from database |
| Bishop PIN in Supabase ("hashed") | MISLEADING CLAIM — REVERTED | Bishop PIN is stored as `btoa(pin)` (base64, reversible), NOT hashed. Anyone with the anon key can dump rf_network_config.bishop_pin_hash and decode it. Tracked as SEC-1. |
| Dynamic manifest generation | DONE | From config table |
| Zero hardcoded names/locations | DONE | Fully white-label |
| **Documentation & Mobile** | | |
| Bishop & Admin guide | DONE | GUIDE-bishop-admin.md |
| In-app Help tab | DONE | 9 expandable sections |
| Responsive bishop/admin dashboard | DONE | Phone-friendly layouts |
| Horizontal scrolling tab bar | DONE | File cabinet style |
| Two-column → single-column on mobile | DONE | Responsive collapse |
| Cross-device PWA icons | DONE | apple-touch-icon, favicon, maskable |

### REMAINING — Deployment Checklist

| Task | Priority | Status |
|------|----------|--------|
| Run migration SQL in Supabase SQL editor | HIGH | DONE |
| Deploy `kgfcm-ai-proxy` edge function to Supabase | HIGH | DONE |
| Deploy push notification edge functions | HIGH | DONE (push-send, push-notify, checkin-remind) |
| Set `ANTHROPIC_API_KEY` in Supabase secrets | HIGH | DONE |
| Connect repo to Vercel for auto-deploy | HIGH | DONE |
| Schedule weekly post count reset cron job | LOW | DONE (pg_cron, every Monday 00:00 UTC) |
| Add custom domain in Vercel | LOW | Pending |

---

## Database Tables

| Table | Records | Status |
|-------|---------|--------|
| rf_pastors | TBD | Migration ready |
| rf_invites | TBD | Migration ready |
| rf_checkins | TBD | Migration ready |
| rf_team_responses | TBD | Migration ready |
| rf_prayer_requests | TBD | Migration ready |
| rf_wins | TBD | Migration ready |
| rf_direct_messages | TBD | Migration ready |
| rf_bishop_messages | TBD | Migration ready |
| rf_announcements | TBD | Migration ready |
| rf_network_config | TBD | Migration ready |
| rf_push_subscriptions | TBD | Migration ready (20260409_002) |

---

## Key Files

| File | Purpose |
|------|---------|
| `kg-pastoral-network.html` | The entire application |
| `sw.js` | Service worker for offline + push |
| `manifest.json` | PWA manifest |
| `vercel.json` | Vercel deployment config |
| `package.json` | Project metadata |
| `supabase/migrations/20260408_001_create_tables.sql` | Database schema + RLS |
| `supabase/migrations/20260409_002_push_subscriptions.sql` | Push subscriptions table |
| `supabase/functions/kgfcm-ai-proxy/index.ts` | Claude Haiku AI proxy |
| `supabase/functions/kgfcm-push-send/index.ts` | Send push notifications |
| `supabase/functions/kgfcm-push-notify/index.ts` | Push notification handler |
| `supabase/functions/kgfcm-checkin-remind/index.ts` | Automated check-in reminders |
| `CLAUDE.md` | Claude Code governance rules |
| `PROJECT_STATE.md` | This file |
| `GUIDE-bishop-admin.md` | Bishop & admin user guide |
| `governance-boundaries.md` | Architecture boundary documentation |

---

## Deployment Steps (Quick Start)

```bash
# 1. Run the migrations (paste into Supabase SQL editor)
#    File: supabase/migrations/20260408_001_create_tables.sql
#    File: supabase/migrations/20260409_002_push_subscriptions.sql

# 2. Set secrets in Supabase dashboard → Settings → Edge Functions
#    ANTHROPIC_API_KEY = your-claude-api-key
#    VAPID_PUBLIC_KEY = your-vapid-public-key
#    VAPID_PRIVATE_KEY = your-vapid-private-key

# 3. Deploy edge functions
npx supabase login
npx supabase link --project-ref kseocbwhuveieqhayske
npx supabase functions deploy kgfcm-ai-proxy --no-verify-jwt
npx supabase functions deploy kgfcm-push-send --no-verify-jwt
npx supabase functions deploy kgfcm-push-notify --no-verify-jwt
npx supabase functions deploy kgfcm-checkin-remind --no-verify-jwt

# 4. Connect to Vercel
#    Push to GitHub → Import in Vercel → Auto-deploys on push to main

# 5. Test
#    - Open deployed URL
#    - Login as bishop
#    - Create an invite, register as a pastor
#    - Submit a check-in, post a prayer, test DMs
#    - Test push notifications
```

---

## Known Limitations — UNDER REMEDIATION

(Previously labeled "MVP acceptable." That framing has been rejected. Each item below
is now tracked in the SECURITY REMEDIATION TRACKER above as work that must be done.)

- Avatar / image data stored as base64 in DB rows — see SEC-9.
- No data export/backup UI — pending; not security-blocking.
