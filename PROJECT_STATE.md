# Kingdom Grace Pastoral Network — Project State

**Last updated:** 2026-04-09
**Status:** Pre-launch — finishing deployment checklist
**Client:** Kingdom Grace Family of Churches and Ministries
**Built by:** Envision VirtualEdge Group LLC

---

## Next Session (2026-04-10)

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
| Removed console.log from production | DONE | Clean production output |
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
| Bishop PIN in Supabase (hashed) | DONE | Removed from client code |
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

## Known Limitations (MVP acceptable)

- Avatar images stored as base64 in database — works under 4MB, move to CDN later
- No data export/backup UI — use Supabase dashboard directly
