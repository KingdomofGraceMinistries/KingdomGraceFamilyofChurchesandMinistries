# Kingdom Grace — Reformation Feature Roadmap

**Purpose:** Features that specifically serve the work of **reformation** — restoring right doctrine, right worship, unity under apostolic/episcopal leadership, discipleship, and evangelism — not just church management.

**Status legend:**
- `SHIPPED` = live in the app
- `TONIGHT` = being built in the current ship-day session
- `PHASE 2` = queued for post-handoff (after Bishop Sasser uses v1 for a week or two)
- `LATER` = valuable but not reformation-critical
- `SKIP` = already covered or premature

**Last updated:** 2026-04-12

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
