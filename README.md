# Kingdom Grace Pastoral Network

A private, mobile-first progressive web app (PWA) for **Kingdom Grace Family of Churches and Ministries** — built for Bishop Peter Sasser to shepherd a network of pastors with weekly check-ins, prayer requests, a wins wall, daily devotions, fasts, peer-to-peer messaging, and bishop blasts.

This is a **production** system carrying confessional pastoral data. It is not an MVP and it is not a demo.

---

## What this app does

**For pastors**
- 6-digit PIN login with full Supabase Auth sessions on the back end
- Daily Spirit-led devotion (Black church voice, hope-forward)
- Weekly pulse check-in (1–5 score + free-text note) feeding bishop oversight
- Prayer wall, wins wall (with photos), peer-to-peer DMs
- Fast participation + breakthrough testimonies
- Announcements, bishop blasts (text + voice), event calendar
- Push notifications (VAPID web push) and offline-first via service worker
- Outreach planning tool with AI suggestions

**For the bishop & admins**
- Network overview with risk colors (thriving / watch / at risk)
- 8-week engagement charts
- Read-side access to prayer requests (bishop only)
- Compose blasts (text + voice), pin announcements
- Invite pastors, manage admins, reset pastor PINs
- Review / edit / approve the day's AI-drafted devotion before publish (or run a fully automatic cron at 05:00 US Central)
- Full audit trail of every action in `rf_audit_log`

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Single HTML file (`kg-pastoral-network.html`) — vanilla HTML / CSS / JS |
| Backend | Supabase (Postgres + REST + Edge Functions + Storage + Auth) |
| AI | Anthropic Claude via the `kgfcm-ai-proxy` edge function |
| Hosting | Vercel (static site, headers in `vercel.json`) |
| PWA | `manifest.json` + `sw.js` service worker |
| Email | Resend (server-side, used for PIN resets) |
| Push | VAPID web push via `kgfcm-push-send` / `kgfcm-push-notify` |

**No build step. No bundler. No framework.** Editing `kg-pastoral-network.html` and pushing to `main` deploys the whole app.

---

## Repo layout

```
.
├── kg-pastoral-network.html          # The entire app — UI + logic
├── manifest.json                     # PWA install manifest
├── sw.js                             # Service worker (offline + cache)
├── vercel.json                       # Routing + strict security headers
├── icons/                            # PWA icons (192, 512)
├── supabase/
│   ├── config.toml                   # Supabase project config
│   ├── functions/
│   │   ├── _shared/                  # CORS allow-list, audit helper, rate limit
│   │   ├── kgfcm-pin-login           # Bishop / admin / pastor login
│   │   ├── kgfcm-pin-register        # New-pastor signup from invite
│   │   ├── kgfcm-pin-reset           # Request reset code (emailed via Resend)
│   │   ├── kgfcm-pin-reset-confirm   # Confirm reset code + set new PIN
│   │   ├── kgfcm-ai-proxy            # Claude API proxy (Bishop AI assist, outreach)
│   │   ├── kgfcm-devotion-generate   # Daily devotion drafter + two-layer reviewer
│   │   ├── kgfcm-audit               # Service-role audit writer
│   │   ├── kgfcm-push-notify         # Build + queue push payloads
│   │   ├── kgfcm-push-send           # Deliver web push via VAPID
│   │   └── kgfcm-checkin-remind      # Weekly check-in reminders
│   └── migrations/                   # Idempotent SQL migrations, time-ordered
├── CLAUDE.md                         # Rules for any AI assistant working in this repo
├── GUIDE-bishop-admin.md             # Plain-language guide for the bishop & admins
├── governance-boundaries.md          # Architecture boundary doc
├── REFORMATION_ROADMAP.md            # Long-term theological / product direction
└── PROJECT_STATE.md                  # Working state snapshot
```

---

## Security posture (read before changing auth code)

1. **PINs are bcrypt-hashed server-side** via the `hash_pin()` / `verify_pin()` SQL functions — both `SECURITY DEFINER`, `service_role`-only. There is no `btoa()` and no client-side hashing anywhere.
2. **RLS is enforced on every table.** `anon` is read-only on a narrow allow-list (branding config, public announcements). Every confidential table requires an authenticated JWT and a per-row policy keyed on `auth.uid()` or the `is_bishop()` claim helper.
3. **All edge functions verify the caller's JWT** (no `--no-verify-jwt`) and lock CORS to the production origin only.
4. **The audit log is the only logging path.** No `console.log` / `console.error` in production code. Every error and security-relevant event routes through `audit()` → `rf_audit_log`, which only the bishop can read.
5. **Reset codes never echo to the requester's browser.** They are emailed by the server via Resend to the address that owns the account.
6. **CSP is strict** (`vercel.json`). `frame-ancestors`, `connect-src`, `img-src`, and `script-src` are explicit allow-lists — no `*`.
7. **Storage buckets** require an authenticated JWT for upload / update / delete. Public read is allowed at the bucket level so direct `/object/public/...` URLs work for avatars and wins photos.

If a change requires loosening any of the above, **stop and ask** — there is almost always a server-side path that keeps the guarantee.

---

## Local development

```bash
npm start              # serves the static site at http://localhost:3000
```

There is no Node build step. The Supabase project is hosted; for migrations and edge functions use the Supabase CLI:

```bash
supabase login
supabase link --project-ref <ref>
supabase db push                                 # apply migrations
supabase functions deploy kgfcm-pin-login        # deploy one function
```

**Never** deploy an edge function with `--no-verify-jwt`. The repo's pre-commit hook and `.claude/` PreToolUse hooks will refuse it.

---

## Deployment

| Step | What happens |
|---|---|
| Push to `main` | Vercel auto-deploys the static site |
| `vercel.json` | Routes all paths to the HTML; sets strict CSP / HSTS / X-Frame-Options |
| Supabase migrations | Apply via `supabase db push` or paste into the SQL Editor |
| Supabase edge functions | Deploy via `supabase functions deploy <name>` (JWT verify ON) |
| Service worker cache bust | Bump the `CACHE_NAME` constant in `sw.js` when shipping a UI change |

---

## Daily devotion cron

A `pg_cron` job named `kgfcm_daily_devotion` runs **10:00 UTC** (≈ 5 AM US Central) every day. It calls `kgfcm-devotion-generate` with `auto_publish:true` so the day's devotion lands on every pastor's home screen by morning, having passed the two-layer review (regex purity scan + Claude reviewer pass). The bishop can still preview / regenerate / hand-edit / replace from the dashboard.

The cron requires a one-time vault secret:

```sql
select vault.create_secret('<SERVICE_ROLE_JWT>', 'kgfcm_service_role');
```

Without that secret the cron fires but the HTTP call is rejected — audited as `DEVOTION_FN_ERROR`. No data damage.

---

## Operational guides

| Document | For whom | Topic |
|---|---|---|
| [`CLAUDE.md`](./CLAUDE.md) | AI assistants working in this repo | Hard rules — production-first, no workarounds, stop-and-ask protocol |
| [`GUIDE-bishop-admin.md`](./GUIDE-bishop-admin.md) | Bishop + admins | Plain-language tour of the dashboard |
| [`governance-boundaries.md`](./governance-boundaries.md) | Engineers | Architecture boundary map |
| [`REFORMATION_ROADMAP.md`](./REFORMATION_ROADMAP.md) | Leadership | Long-term direction |
| [`PROJECT_STATE.md`](./PROJECT_STATE.md) | Engineers | Current working state |

---

## License

UNLICENSED — private to Kingdom Grace Family of Churches and Ministries.
