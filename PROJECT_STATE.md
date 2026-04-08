# Kingdom Grace Pastoral Network — Project State

**Last updated:** 2026-04-08
**Status:** Pre-launch — finishing deployment checklist
**Client:** Kingdom Grace Family of Churches and Ministries
**Built by:** Envision VirtualEdge Group LLC

---

## App Summary

A mobile-first PWA for pastoral oversight. Two interfaces:
- **Pastors** — check-ins, prayer wall, wins, team devotionals, messaging, announcements
- **Bishop (Peter Sasser)** — full dashboard with burnout tracking, moderation, engagement analytics, invites, blast messaging

**Tech:** Single HTML file + Supabase (PostgreSQL + Edge Functions) + Claude Haiku AI + Vercel hosting

---

## Completion Tracker

### DONE

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
| PWA manifest + icons | DONE | SVG icons, standalone display |
| Supabase key fallback (publishable → anon) | DONE | Future-proofed for key migration |
| Footer (Envision VirtualEdge) | DONE | Both pastor and bishop views |
| Database migration SQL | DONE | 9 tables + indexes + RLS + weekly reset function |
| AI proxy edge function | DONE | Claude Haiku, 3 call types (care/team/default) |
| RLS policies | DONE | All 9 tables covered |
| vercel.json (routing + headers) | DONE | Security headers + SW support |
| package.json | DONE | Metadata + local dev server |

### REMAINING — Deployment Checklist

| Task | Priority | Estimated Effort |
|------|----------|-----------------|
| Run migration SQL in Supabase SQL editor | HIGH | 5 min |
| Deploy `kgfcm-ai-proxy` edge function to Supabase | HIGH | 10 min |
| Set `ANTHROPIC_API_KEY` in Supabase secrets | HIGH | 2 min |
| Connect repo to Vercel for auto-deploy | HIGH | 5 min |
| Replace bishop PIN "000000" with real PIN | MEDIUM | 2 min |
| Convert SVG icons to PNG for broader PWA support | LOW | 10 min |
| Schedule weekly post count reset cron job | LOW | 5 min |
| Add custom domain in Vercel | LOW | 5 min |

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

---

## Key Files

| File | Purpose |
|------|---------|
| `kg-pastoral-network.html` | The entire application |
| `sw.js` | Service worker for offline support |
| `manifest.json` | PWA manifest |
| `vercel.json` | Vercel deployment config |
| `package.json` | Project metadata |
| `supabase/migrations/20260408_001_create_tables.sql` | Database schema + RLS |
| `supabase/functions/kgfcm-ai-proxy/index.ts` | Claude Haiku AI proxy |
| `CLAUDE.md` | Claude Code governance rules |
| `PROJECT_STATE.md` | This file |
| `governance-boundaries.md` | Architecture boundary documentation |
| `claude-code-frequent-mistakes.md` | AI coding anti-patterns |

---

## Deployment Steps (Quick Start)

```bash
# 1. Run the migration (paste into Supabase SQL editor)
#    File: supabase/migrations/20260408_001_create_tables.sql

# 2. Set secrets in Supabase dashboard → Settings → Edge Functions
#    ANTHROPIC_API_KEY = your-claude-api-key

# 3. Deploy edge function
npx supabase login
npx supabase link --project-ref kseocbwhuveieqhayske
npx supabase functions deploy kgfcm-ai-proxy --no-verify-jwt

# 4. Connect to Vercel
#    Push to GitHub → Import in Vercel → Auto-deploys on push to main

# 5. Test
#    - Open deployed URL
#    - Login as bishop (PIN: 000000)
#    - Create an invite, register as a pastor
#    - Submit a check-in, post a prayer, test DMs
```

---

## Known Limitations (MVP acceptable)

- PIN hashing uses btoa (base64), not bcrypt — acceptable for MVP, upgrade later
- Avatar images stored as base64 in database — works under 4MB, move to CDN later
- Bishop credentials hardcoded in HTML — move to database after launch
- No push notifications yet — pastors must open the app
- No data export/backup UI — use Supabase dashboard directly
