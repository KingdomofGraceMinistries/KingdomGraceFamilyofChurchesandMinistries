# Kingdom Grace — Reformation Feature Roadmap

**Purpose:** Features that specifically serve the work of **reformation** — restoring right doctrine, right worship, unity under apostolic/episcopal leadership, discipleship, and evangelism — not just church management.

**Status legend:**
- `SHIPPED` = live in the app
- `TONIGHT` = being built in the current ship-day session
- `PHASE 2` = queued for post-handoff (after Bishop Sasser uses v1 for a week or two)
- `LATER` = valuable but not reformation-critical
- `SKIP` = already covered or premature
- `DEADLINE` = infrastructure/security work with a hard external date — not a feature, but will break the app if ignored

**Last updated:** 2026-07-04

---

## ⏳ Infrastructure deadlines — not features, but hard dates

### I1. Supabase legacy API key end-of-life (anon / service_role JWTs)
**Status:** `DEADLINE` — **hard cutoff: end of 2026** (~6 months out as of 2026-07-04)

**What's happening (verified against Supabase live docs, 2026-07-04):**
Supabase replaced the old key model. The legacy `anon` and `service_role` keys are **JWTs signed by the project's JWT secret**; they are *"no longer recommended"* but **keep working until the end of 2026**. The new keys — `sb_publishable_…` (replaces `anon`) and `sb_secret_…` (replaces `service_role`) — are **opaque, non-JWT tokens** that can be rotated/revoked independently.

Reference docs:
- Migrating to publishable and secret API keys — `/docs/guides/getting-started/migrating-to-new-api-keys`
- Understanding API keys — `/docs/guides/getting-started/api-keys`
- JWT Signing Keys — `/docs/guides/auth/signing-keys`

**Why this bites us specifically:**
The new `sb_secret_…`/`sb_publishable_…` keys are **not JWTs**, and several paths only accept a JWT-format bearer:
- **PostgREST** returns **401** for a non-JWT `Authorization: Bearer` (supabase-js hands the key straight through). This is documented in-code across the edge functions (e.g. `kgfcm-pin-login`, `kgfcm-checkin-remind`, `kgfcm-audit`, `kgfcm-push-send`).
- **`pg_net` / Database Webhooks** reject non-JWT bearers — the secret key must go on the `apikey` header instead.

That is exactly why every edge function resolves its backend key as
`Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SECRET_KEY")` —
**JWT-format `service_role` first, on purpose**, because the opaque `sb_secret_` key would 401 on the PostgREST/pg_net bearer path today. This is deliberate and correct *for now*, but it is a dependency on a key type that dies end of 2026.

**Already done (no action needed):**
- Client (`kg-pastoral-network.html`) already migrated to the **publishable** key only; the legacy anon JWT was removed (see the `SEC-8` note in the config block). Publishable = same low anon privileges, RLS behaves identically, per-user Auth JWTs unaffected.

**Still to migrate before end of 2026 (auth-critical — plan deliberately, do NOT change casually):**
The edge functions' backend key path. Options, in preference order:
1. **Move backend calls onto the new key model correctly** — pass `sb_secret_…` on the **`apikey` header** (not `Authorization: Bearer`) for PostgREST/`pg_net` calls, per the migration guide. Verify each function's REST + `net.http_post` call sites.
2. **Adopt the new JWT Signing Keys system** (asymmetric) so edge functions verify/issue JWTs without the Auth server in the hot path — larger change, best long-term security/performance.
3. **Wait for Supabase to close the gap** — PostgREST may start accepting the new key format as a bearer before EOL. Do not rely on this; track it, but plan as if it won't happen.

**Trigger:** schedule this no later than **Q3 2026** so it's tested well before the end-of-year cutoff. When Supabase disables legacy keys, any function still sending the JWT `service_role` key as a bearer will start returning 401 — i.e. logins, check-in reminders, audit writes, and push sends would break for every pastor.

---

#### Update 2026-08-14 (second pass) — the running system, not the assumptions

**Everything in the first pass below was written without inspecting the deployed environment. Read this section instead; the one after it is kept only to show what was assumed and why it was wrong.**

Audited the live edge-function environment by deploying a throwaway diagnostic that reported key **formats only**, never values:

| Env var | Actual format |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | **`sb_secret_…`** (opaque, new model) |
| `SB_SECRET_KEY` | **`sb_publishable_…`** ← wrong key in this variable |
| `SUPABASE_ANON_KEY` | `sb_publishable_…` |
| `SB_PUBLISHABLE_KEY` | `sb_publishable_…` |

**1. The edge-function half of I1 is already done.** The platform injects a new-format `sb_secret_` key under the legacy variable *name*. Since every function resolves `SUPABASE_SERVICE_ROLE_KEY` first, all 12 have been running on the new key model already — and logins, audit writes and devotion generation all work. That is direct proof that opaque secret keys work against **both PostgREST and GoTrue**, which is exactly what the original entry said was blocking. No code change is needed for the functions.

**2. `SB_SECRET_KEY` is misconfigured and is a live hazard.** It holds a *publishable* key. Every function reads `SUPABASE_SERVICE_ROLE_KEY ?? SB_SECRET_KEY`, so if the first were ever empty, all 12 would silently fall through to **anon privileges** — audit writes rejected, service-role work blocked by RLS, logins failing in confusing ways. A fallback should never degrade to a weaker credential.

> **Action required (dashboard):** either clear `SB_SECRET_KEY`, or set it to a real `sb_secret_…` key. Clearing it is the safer default — with it unset the fallback resolves to `""`, which fails loudly and immediately instead of half-working with the wrong privileges.

**3. Do NOT invert the resolution order.** The first pass below proposed `SB_SECRET_KEY ?? SUPABASE_SERVICE_ROLE_KEY`. Against the actual environment that would have switched all 12 functions to the publishable key instantly and taken production down. The current order is correct and should stay until `SB_SECRET_KEY` is fixed.

**4. The only genuine remaining exposure is `pg_net`.** Vault secret `kgfcm_service_role` is confirmed a **legacy JWT** (219 chars, three segments) and is what the `kgfcm_daily_devotion` cron sends as its bearer. It dies with the legacy key model.

This is not a value swap. `kgfcm-devotion-generate-v2` identifies the cron caller by *decoding* the bearer and checking `claims.role === "service_role"`. Handed an opaque `sb_secret_` key, `decodeJwtClaims()` returns null and the request is refused by the `Invalid JWT` 401. Migrating the cron therefore needs a deliberate auth redesign — options include a shared secret header verified in-function, or moving the schedule off `pg_net` onto a Supabase scheduled function. **Own session, not a tail-end change.**

**Net:** I1 is far smaller than written. One dashboard fix (item 2), one scoped redesign (item 4). The rest is already complete.

---

#### Update 2026-08-14 (first pass — SUPERSEDED, kept for the record)

**Retested against the live project.** The claim above — that a non-JWT key 401s on the PostgREST bearer path — did not reproduce. Sending the publishable key (also opaque, non-JWT) as `Authorization: Bearer` against `/rest/v1/rf_devotions` returned:

```
HTTP 401  {"code":"42501","message":"permission denied for table rf_devotions"}
```

`42501` is a **Postgres grant** error. A request rejected for an unparseable JWT never reaches the grant check — it fails earlier, in the auth layer. So the key was accepted and resolved to a role, and was then correctly denied by table permissions. Option 3 above ("wait for Supabase to close the gap") appears to have happened.

This has not been confirmed with an actual `sb_secret_…` key, because secret keys are not exposed through the MCP connection. Treat it as strong evidence, not proof, until step 2 below passes.

**Consequence:** this is now most likely a config change, not the redesign options 1 and 2 imply.

**The real risk is different from what was written.** All 12 functions resolve the key as:

```ts
Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SECRET_KEY")
```

The platform injects `SUPABASE_SERVICE_ROLE_KEY` automatically, so it always wins. That means the `SB_SECRET_KEY` fallback **can never be exercised while legacy keys still work** — it activates for the first time on the day Supabase disables them, untested, across every function at once. An untested fallback on the login path is the actual hazard here, not the bearer format.

**Fix: invert the order** to `SB_SECRET_KEY ?? SUPABASE_SERVICE_ROLE_KEY`. Setting the env var then becomes a deliberate, testable cutover, and unsetting it is an instant rollback. That inversion is inert while `SB_SECRET_KEY` is unset — behaviour stays byte-identical to today — so it can ship ahead of the cutover safely.

**Sequence (steps 1 and 3 need dashboard access; they cannot be done over MCP):**

1. **Create the secret key** — Dashboard → Project Settings → API Keys → create `sb_secret_…`. Do not paste it into a repo, a commit, or a chat.
2. **Set it as an edge-function secret** named `SB_SECRET_KEY` (Edge Functions → Secrets, or `supabase secrets set`).
3. **Prove it on one low-risk function first** — `kgfcm-audit` is the right candidate: it writes one table, is not on the login path, and a failure is visible without locking anyone out. Invert the order there, deploy, exercise it, confirm the audit row lands.
4. **Then roll out** the inversion to the remaining 11 and redeploy.
5. **Verify the GoTrue admin paths separately.** `kgfcm-pin-login` calls `auth.admin.createUser`, `generateLink` and `listUsers`. Those hit GoTrue, not PostgREST, and are the least certain part of this migration — PostgREST accepting the key does not prove GoTrue does. Test a real PIN login before considering the cutover done.
6. **Do not remove** `SUPABASE_SERVICE_ROLE_KEY` until every function has run on the secret key. It is the rollback.

**Also check `pg_net`.** The `kgfcm_daily_devotion` cron reads `kgfcm_service_role` from vault and sends it as a bearer (migration `20260530180000`). That vault secret is a separate copy of the legacy key and will die with it — it is not covered by any edge-function env var change.

---

## Tier 1 — Core reformation features

### 1. Doctrinal Statement / Core Beliefs page
**Status:** `PHASE 2`

**Why it matters:** Reformation networks live and die by doctrinal clarity. Right now there is nothing in the app that says *this is what Kingdom Grace believes*. New pastors joining via invite should affirm the statement before they're fully credentialed. Existing pastors should be able to reference it anytime.

**Scope:**
- New static screen `s-doctrine` with the bishop's doctrinal statement pulled from `rf_network_config.doctrinal_statement` (rich text or markdown).
- Link from pastor home screen under a "What We Believe" tile.
- On pastor registration, show the statement and require a "I affirm this" checkbox before account creation completes.
- Bishop / admin can edit the statement from the dashboard.

**Dependencies:** Bishop needs to draft the statement first. Do not invent doctrine on his behalf.

---

### 2. Teaching Library
**Status:** `PHASE 2`

**Why it matters:** This is *how reformation spreads*. A voice blast is ephemeral; a teaching library lets pastors study, go back to the source material, and onboard into the bishop's heart and doctrine over time.

**Scope:**
- New table `rf_teachings` (id, title, description, scripture_ref, body_text, audio_url, video_url, category, tags, published_at, created_by).
- New screen `s-teachings` with a filterable list (by category: doctrine, spiritual formation, leadership, evangelism, prayer).
- Each teaching opens to a detail view with full text + audio/video player.
- Bishop / admin compose flow to add teachings.
- Reuse the `voice` storage bucket for audio; optional: video stored externally (YouTube link or similar — do not host video files directly).
- Search/filter by tag.

**Dependencies:** Reuses the `voice` bucket already created for bishop blasts.

---

### 3. Fasting / Consecration Tracker
**Status:** `TONIGHT`

**Why it matters:** Corporate fasting is central to almost every reformation movement in church history. Bishop Sasser can use this monthly to call the whole network into agreement. It turns individual discipline into shared spiritual momentum.

**Scope:**
- Table `rf_fasts` (id, title, description, start_date, end_date, declared_by, fast_type, created_at).
- Table `rf_fast_participants` (id, fast_id, pastor_id, pastor_name, joined_at, breakthrough_text, breakthrough_at).
- Bishop / admin can declare a fast from the dashboard (title, description, dates, optional scripture and fast type — e.g., Daniel fast, Esther fast, water-only, etc.).
- Active or upcoming fasts appear on the pastor home screen as a card with "Count me in" button.
- After joining, pastor can post a short breakthrough note during or after the fast.
- Everyone sees the count of pastors participating and can read the breakthrough notes.
- History screen showing past fasts.

**Dependencies:** none.

---

### 4. Ordination / Credentialing Tracker
**Status:** `TONIGHT`

**Why it matters:** Formalizes the network. Who is ordained, when, by whom, and under what covering. Bishop should be able to see his spiritual sons at a glance; pastors should be able to see and display their own credentials. Required for any recognized denomination / ministerial network.

**Scope:**
- Add columns to `rf_pastors`:
  - `credential_type` text — Minister, Elder, Pastor, Apostle, Prophet, Evangelist, Teacher, Deacon, Lay Leader
  - `ordination_date` date
  - `ordained_by` text
  - `covering_under` text — spiritual covering / overseer
  - `credential_status` text — active, candidate, sabbatical, emeritus
- Pastor profile edit form gains a "Credentials" section (pastor can view; bishop can edit).
- Pastor view profile displays credentials.
- Bishop dashboard gets a new panel "Credentials" showing all pastors with their credential type + ordination date.
- Bishop can edit credentials from the pastor drill-down.

**Dependencies:** none.

---

### 6. Events / Calendar
**Status:** `TONIGHT`

**Why it matters:** Critical for a connected network. Conferences, revivals, pastors' retreats, ordinations, board meetings, fasting kickoffs. Surprisingly absent from v1.

**Scope:**
- Table `rf_events` (id, title, description, event_date, event_time, end_date, location, location_url, event_type, is_virtual, rsvp_required, created_by, created_at).
- Event types: conference, revival, ordination, retreat, fast, prayer night, council meeting, training, other.
- Bishop / admin can create events from the dashboard.
- Pastor home screen shows a "Coming Up" card with the next 2–3 events.
- New screen `s-events` with full list (upcoming + past tabs).
- Detail view on tap — time, location, description, link to virtual meeting if applicable.
- Phase 2: RSVP button that writes to `rf_event_rsvps` so the bishop can see who's coming.

**Dependencies:** none.

---

## Tier 2 — Still valuable, not reformation-specific

### 5. Church Directory
**Status:** `LATER`

**Why:** Searchable list of the actual churches in the network (not just pastors) — address, service times, phone, website, pastor name. Lets a traveling believer find a Kingdom Grace church in their city. Lets pastors see the physical reach of the network.

**Scope:**
- Table `rf_churches` (id, pastor_id, church_name, address, city, state, zip, phone, website, service_times jsonb, photo_url, notes).
- Currently `rf_pastors.church_name` + `city` are free-text on the pastor profile — promote to a proper churches table.
- New screen `s-directory` with search by city/state/name.
- Each church card links to the pastor view profile.

---

### 7. Testimony Wall
**Status:** `PHASE 2`

**Why:** Longer-form than Wins — written or recorded testimonies of salvations, healings, deliverances, restored marriages. Different purpose than Wins (which are short celebrations); Testimonies are **storytelling**. The fruit of the reformation, displayed.

**Scope:**
- Table `rf_testimonies` (id, pastor_id, title, body_text, audio_url, video_url, category, is_featured, created_at).
- Categories: salvation, healing, deliverance, marriage, provision, calling, other.
- New screen `s-testimonies` with a feed.
- Pastors compose with text + optional audio (reuse voice bucket).
- Bishop can feature a testimony so it rotates on the home screen.

---

### 8. Apostles' Council Voting
**Status:** `PHASE 2`

**Why:** If there's a governing body, it needs a real voting/polity tool. The Apostles' Council button is already in the pastor home as a "Coming Soon" placeholder.

**Scope:**
- Table `rf_council_motions` (id, title, body, raised_by, raised_at, closes_at, status).
- Table `rf_council_votes` (motion_id, member_id, vote enum: yea/nay/abstain, rationale, voted_at).
- Council members table (or role flag on `rf_pastors`).
- New screen accessible only to council members.
- Bishop sees a summary on the dashboard.

---

## Skipped / already covered

### Giving / Tithes
**Status:** `SKIP` — already a "Coming Soon" button. Needs real Stripe / Givelify integration and a proper financial handling story. Don't ship a placeholder; build it correctly in Phase 2 with legal/compliance review.

### Newsletter / Update Digest
**Status:** `SKIP` — the bishop blast feature (now with voice + seen-by + reply) already covers this use case. A digest would be duplicative.

### Crisis / Emergency Line
**Status:** `SKIP` — DMs to the bishop + burnout tracking + 30-second notification polling already give the bishop visibility into pastors in distress. Formalize only if it proves needed.

### Mentorship Pairs
**Status:** `LATER` — can be handled informally via DMs + pastor view profiles. Formalize only after we see real usage patterns.

### Marriage / Family Support
**Status:** `LATER` — eventually a resource library for pastor families, but lower priority than core reformation features.

### Sabbatical Tracker
**Status:** `LATER` — the existing burnout scoring + check-in pulse already gives the bishop early warning. Formal sabbatical tracking is Phase 3+.

---

## Build order recommendation for Phase 2 (after handoff)

1. **Doctrinal Statement** (smallest, most symbolic — one screen, one config row)
2. **Teaching Library** (reuses voice bucket, highest spiritual impact)
3. **Church Directory** (promotes existing pastor data to proper churches table)
4. **Testimony Wall** (rounds out the "fruit of the work" story)
5. **Apostles' Council Voting** (once council membership is formalized)

Revisit this document after Bishop Sasser has used v1 for 1–2 weeks — real usage will sharpen which features actually move the needle and which were Claude guessing at reformation priorities.
