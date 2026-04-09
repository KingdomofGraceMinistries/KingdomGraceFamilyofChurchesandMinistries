# Project State — Kingdom Grace Pastoral Network

## Next Session (2026-04-10)

### Priority Tasks

- [ ] **Bishop Profile Page** — Dedicated page for Bishop Peter Sasser with his photo, bio, and a photo of him and his wife. Accessible from the dashboard and visible to all pastors.

- [ ] **Apostle Ericka Sasser Page** — Dedicated page for Apostle Ericka Sasser (Bishop's wife) with her photo and bio. Same style as the Bishop's page.

- [ ] **Blast Message Branding** — Change bishop blast messages to display as **"From the Desk of the Bishop"** instead of the current generic "From Bishop Sasser" format. Apply this to:
  - Home screen blast display
  - Push notification title
  - Message history

### Notes

- Bishop: Peter Sasser
- Wife: Apostle Ericka Sasser
- Will need: photos of Bishop, Apostle Ericka, and a photo of them together
- Bio text for both — ask user to provide or draft from available info

---

## Completed Today (2026-04-09)

### Bug Fixes & Code Quality
- [x] Added `esc()` HTML escaper — fixed XSS across 30+ innerHTML calls
- [x] Implemented 3 stub functions (encouragePrayer, bishopPrayFor, bishopCelebrate)
- [x] Added error feedback to 11+ silent catch blocks
- [x] Removed console.log from production code

### Notification System
- [x] In-app toast notifications with badge counts
- [x] Notification sound (Web Audio API chime)
- [x] Browser Notification API (outside app when tab not focused)
- [x] 30-second polling for new DMs, prayers, announcements, blasts
- [x] VAPID push notifications (works when app is fully closed)
- [x] Service worker push + notificationclick handlers
- [x] Edge Functions deployed: kgfcm-push-send, kgfcm-push-notify

### High Priority Features
- [x] Forgot PIN / PIN reset flow (pastor + bishop-triggered reset)
- [x] Search across prayers, wins, messages, announcements, pastors
- [x] Read receipts on DMs (single check = sent, double gold = read)
- [x] Automated check-in reminders (Edge Function + overdue badges)

### Admin & Onboarding
- [x] Admin role with separate PIN login and restricted dashboard access
- [x] Simplified invite flow (name → create → send via text/share/copy)
- [x] Simplified pastor registration (link → name + email + PIN → done)
- [x] Login help dropdown explaining all three roles

### White Label
- [x] All branding moved to Supabase rf_network_config table
- [x] Bishop PIN stored in Supabase (hashed), removed from client code
- [x] Dynamic manifest generation from config
- [x] Zero hardcoded network names, bishop names, or locations in code

### Documentation
- [x] Bishop & Admin guide document (GUIDE-bishop-admin.md)
- [x] In-app Help tab with 9 expandable sections

### Mobile
- [x] Bishop/admin dashboard responsive for phone screens
- [x] Horizontal scrolling tab bar (file cabinet style)
- [x] Two-column layouts collapse to single column on mobile
