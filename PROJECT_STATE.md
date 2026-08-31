# Kingdom Grace Pastoral Network — Project State

**Last updated:** 2026-08-28
**Status:** In production — security remediation in progress (see tracker below)
**Client:** Kingdom Grace Family of Churches and Ministries
**Built by:** Envision VirtualEdge Group LLC

---

## 🧭 2026-08-28 — live audit + migration ledger reconciliation

First session to read the deployed project end-to-end rather than reason from
the repo. Three things closed; the findings that stayed open are folded into
the lists below rather than repeated here.

### A. Migration ledger — reconciled, `db push` is safe again

**What was wrong.** The repo and the remote ledger had diverged three ways:

1. **Four repo migrations were applied but unrecorded** — `devotion_cron_point_at_v2`,
   `rf_admins_email_unique_index`, `create_admin_strict_bishop_only`,
   `rls_initplan_and_fk_indexes`. Applied over MCP/SQL editor, so no ledger row.
   Each was verified present in the database by its effects, not by trusting the
   file: the unique index on `lower(email)` exists, `kgfcm_daily_devotion` posts
   to `…/kgfcm-devotion-generate-v2`, `create_admin`'s body carries the
   `caller_role <> 'bishop'` guard, and the performance advisor reports zero
   `auth_rls_initplan` and zero unindexed-FK lints.
2. **Two live migrations had no repo file at all** — `20260515173202_tighten_voice_and_wins_buckets`
   and `20260515173803_ann_self_read_includes_own_removed`. Recovered verbatim
   (comments intact) from `supabase_migrations.schema_migrations.statements` and
   written as repo files. **This is why SEC-16's claim had quietly become false.**
3. **Four legacy-named files carried malformed versions** — `20260408_001_*` etc.
   parsed as 8-digit versions, and `_003`/`_004` both collapsed to `20260412`,
   a primary-key collision. Renamed via `git mv` to `20260408000100`,
   `20260409000200`, `20260412000300`, `20260412000400` — order preserved, all
   sorting before `20260412210000_consolidated_pre_auth`.

**The hazard this closed:** `supabase db push` would have tried to replay ~14
local-only migrations against production, including the 538-line `real_auth`.

**What was done.** All via the **CLI** — see the rule in section D.
`migration repair --status applied` on the 14 local-only versions, then
`--status reverted` on 16 superseded remote-only rows. The revert deletes ledger
rows only; verified afterwards that the schema was untouched (21 `rf_` tables,
69 policies, 3 cron jobs, 6 buckets, 92 devotions, 219 audit rows — all
unchanged).

**Provenance of the 16 reverted rows.** They were the granular originals that
the repo had already consolidated. Every one is covered by a file that is now
marked applied — recorded here because the ledger rows themselves are gone:

| Reverted remote rows | Superseded by repo file |
|---|---|
| `20260408221221`, `…221240`, `…221253`, `…222155` | `20260408000100_create_tables.sql` |
| `20260409033846` | `20260409000200_push_subscriptions.sql` |
| `20260412004052` | `20260412000300_wins_images_outreach.sql` |
| `20260412023404` | `20260412000400_voice_seen_reactions_fasts_events_credentials.sql` |
| `20260409035012`, `…040326`, `…041744`, `20260412203307` | `20260412210000_consolidated_pre_auth.sql` |
| `20260513170010`, `172341`, `174141`, `180102`, `183034` | `…170000_real_auth`, `…170100_auth_helpers_invoker`, `…173000_create_admin_rpc`, `…180000_image_data_to_image_url`, `…200000_devotions` |

**Final state:** 24 local files ↔ 24 ledger rows, one-to-one. 0 pending, 0
remote-only. `db push --dry-run` → `{"upToDate":true}`.

**Knock-on: three historical migrations are now exempt from the content guard.**
Git reports a rename as a new path, so renaming the legacy files exposed them to
the scanner for the first time. All three carry pre-auth-era
`to anon … using(true)` policies that SEC-3 dropped in
`20260513170000_real_auth.sql`, and an applied migration cannot be edited
without breaking the reproducibility the ledger depends on. They are exempted in
`content-scan.sh` **by exact filename** — deliberately not by a
`migrations/*` wildcard or a date cutoff, so every new migration is still
scanned in full. Verified after the change: a new migration containing
`to anon … using(true)` still blocks, and a lookalike filename
(`…_create_tables_v2.sql`) also still blocks.

Live confirmation that the exempted SQL is genuinely dead: `rf_wins`,
`rf_announcements` and friends carry no anon write policies. The only anon
policy left network-wide is `config_anon_branding_read` — a scoped SELECT on
`rf_network_config` excluding `bishop_pin_hash`, `bishop_pin_bcrypt`,
`bishop_email`, `vapid_private_key` and `resend_api_key` — which is the
pre-login branding read the app needs.

### B. `config.toml` now declares the JWT map — SEC-5 hardening

`config.toml` previously declared **no** `[functions.*]` blocks, so the deployed
`verify_jwt` flags lived only in the dashboard. An undeclared
`supabase functions deploy` would have applied the CLI default and flipped the
PIN endpoints to `verify_jwt = true` — **locking every pastor out of login.**

All 12 repo functions are now declared explicitly, matching the live project as
read on 2026-08-28. Correcting an earlier assumption in this file:
`kgfcm-admin-pin-issue` is deployed **`verify_jwt: true`**, not false — only
four functions run with verification off.

| `verify_jwt = false` (pre-session auth boundary) | `verify_jwt = true` |
|---|---|
| `kgfcm-pin-login`, `kgfcm-pin-register`, `kgfcm-pin-reset`, `kgfcm-pin-reset-confirm` | `admin-pin-issue`, `ai-proxy`, `audit`, `checkin-remind`, `devotion-generate`, `devotion-generate-v2`, `push-notify`, `push-send` |

The four `false` entries have no JWT to verify by definition; each does its own
rate limiting and constant-time comparison (`_shared/rate_limit.ts`).
`kgfcm-deploy-smoke-test` is deliberately **not** declared — it was not in the
repo and was deleted on 2026-08-28 (see section I).

### C. Security advisors — all three explained, none are live holes

Read the advisors before changing anything here. Two of the three are working
as designed and will keep firing:

| Advisor | Verdict |
|---|---|
| `create_admin` executable by `authenticated` (WARN) | **Deliberate — do not "fix".** Migration `20260814190000` keeps the EXECUTE grant on purpose and enforces `app_metadata.role = 'bishop'` *inside the function body*. Its header explains why `is_bishop()` could not be narrowed: it really means "is staff" and a dozen RLS policies depend on that looser reading. The linter cannot see body-level guards. Revoking the grant would break the bishop's Admins tab. |
| `rf_reset_attempts` RLS enabled, no policies (INFO) | **Correct by design.** Deny-all to anon/authenticated; only service_role reaches it, which is what a rate-limit table wants. |
| Leaked password protection disabled (WARN) | **Not applicable.** Auth is 6-digit PIN + magic link. There are no user-chosen passwords for HaveIBeenPwned to check. |

Performance advisors: 15 unused indexes and 9 multiple-permissive-policy
warnings. Both are expected — the unused indexes reflect a network with one
pastor and near-zero rows, and the permissive-policy pairs are the inherent
cost of the `*_self_*` + `*_bishop_*` pattern. Neither is worth acting on at
this data volume.

### D. Migrations are CLI-only — standing rule

**Never apply DDL through the Supabase MCP connector** (`apply_migration`, or
DDL via `execute_sql`). MCP-applied DDL is precisely what produced the drift in
section A: schema landed without a ledger row or a repo file, so the repo
stopped being able to reconstruct production. Use the CLI —
`migration up`, `db push`, `migration repair` — which writes the file and the
ledger together. MCP remains the right tool for **read-only** inspection:
`list_tables`, `get_advisors`, `list_migrations`, `SELECT`s.

### E. Live inventory, as read 2026-08-28

Project `kseocbwhuveieqhayske`, ACTIVE_HEALTHY, Postgres 17.6.1.104, us-east-2.

- **21 tables, RLS enabled on every one.**
- Data is thin but the system is demonstrably working: 1 pastor, 2 admins,
  3 check-ins, 3 announcements, 92 devotions, 219 audit rows, 6 push
  subscriptions. The audit logger and the devotion cron are both live.
- **3 cron jobs:** `reset-weekly-posts` (Mon 00:00), `kgfcm_rate_limit_cleanup`
  (03:15), `kgfcm_daily_devotion` (10:00, still on the legacy vault JWT).
- **12 edge functions deployed**, matching the repo one-for-one. Was 13 until
  2026-08-28, when the retired `kgfcm-deploy-smoke-test` stub was deleted —
  see section I.
- **Buckets:** `credentials` and `ministry-photos` private; `avatars`,
  `announcements`, `voice`, `wins` public with no SELECT-list policies —
  matches SEC-15 (direct URL works, enumeration does not).

### F. Still open after this session

- **CORRECTION — `ALLOWED_ORIGINS` is set, and CORS is locked.** An earlier
  draft of this section claimed the variable was unset and that
  `isOriginAllowed()` was therefore failing open. That was wrong: it read
  SEC-5's "Action: lock CORS by setting `ALLOWED_ORIGINS`" as an open to-do
  instead of checking the environment. `supabase secrets list` shows the
  variable present since **2026-05-14**.

  Verified empirically on 2026-08-28 by sending preflights with different
  `Origin` headers to `kgfcm-pin-login` and reading the ACAO back — an echoed
  origin is allow-listed, while a constant `https://kingdomgracefamily.com`
  is just `ALLOWED[0]`, the fallback for anything unmatched:

  | Origin | ACAO | Verdict |
  |---|---|---|
  | `https://kingdomgracefamily.com` | echoed | allowed |
  | `https://www.kingdomgracefamily.com` | echoed | allowed |
  | `https://kingdom-grace-familyof-churchesand.vercel.app` | `…gracefamily.com` | not allowed |
  | `https://kingdom-grace-familyof-church-kingdomofgraceministries-projects.vercel.app` | `…gracefamily.com` | not allowed |
  | `https://not-your-site.example.com` (control) | `…gracefamily.com` | correctly rejected |

  The allowlist is the apex plus `www` and nothing else. **This is the intended
  posture — confirmed 2026-08-28 that nobody uses the Vercel-assigned URLs.**
  Do not add them. Note the consequence so it is not later mistaken for a bug:
  at either `.vercel.app` domain the static app loads but **login is dead** —
  seven functions, `kgfcm-pin-login` among them, return `403 Forbidden origin`
  for an unallowed origin, and the browser would reject the ACAO mismatch
  regardless.

  ~~**What remains is genuinely small** — the `if (ALLOWED.length === 0)
  return true` fail-open branch in `_shared/cors.ts`.~~ **Deleted 2026-08-31.**
  It was dead code in this deployment (`ALLOWED` is non-empty), so runtime
  behaviour is byte-identical — but it silently disabled the origin gate on
  every function the moment the variable was cleared or mistyped, which is the
  opposite of how a security control should fail. `isOriginAllowed()` now fails
  closed, and the header comment on the file says so and says not to re-add a
  permissive fallback. `deno check` passes.

  **This needs a redeploy to take effect.** `_shared/cors.ts` is compiled into
  each function at deploy time, so all twelve call sites keep running the old
  module until they are redeployed. No urgency — the deployed behaviour is
  already correct while `ALLOWED_ORIGINS` is set. Deploy without
  `--no-verify-jwt`; see section I on how a redeploy of one function last time
  took all twelve with it.
- **Four stale `--no-verify-jwt` instructions** remain, all in the superseded
  handoff sections of this file. They contradict the live deployment, where
  `kgfcm-ai-proxy` runs `verify_jwt: true`. The fifth, in
  `RUN_THIS_IN_SUPABASE.sql`, went with that file — see the retirement note in
  section G.
- ~~`governance-boundaries.md` does not exist.~~ **Written 2026-08-28.** It
  documents Kingdom Grace as what it is: a **standalone system** with no
  upstream, downstream or sibling — one Supabase project, one Vercel team, one
  domain, one AI proxy, one mail sender, and no shared library, schema,
  credential or cross-project connection anywhere in the repo.

  **The "System A (WellFit) / System B (Envision Atlus)" language in
  `CLAUDE.md` does not describe this codebase.** Both belong to the operator's
  other work. That six-line block is the only occurrence of those terms in the
  repo, nothing references it, and it arrived in `8e191d8` — the first
  substantive commit — as part of the initial `CLAUDE.md` scaffold, which also
  reproduces `claude-code-frequent-mistakes.md` verbatim. The operator
  confirmed they do not recognise the terms as describing this project.
  **That bullet list was deleted from `CLAUDE.md` on 2026-08-31.** Its
  Governance Boundaries section now states that Kingdom Grace is standalone,
  lists what `governance-boundaries.md` actually covers, and records that the
  System A/B language was scaffold carry-over — so a future session reads the
  correction rather than the phantom map.

  **The first draft of that file got this wrong and had to be rewritten.** An
  unrelated project appeared in `list_projects` because the Supabase connector
  was still authenticated to another of the operator's accounts at the start of
  the session. Rather than treating that as the misconfiguration it was, the
  draft reached for the `CLAUDE.md` System A/B line to explain it, wrote the
  unrelated project up as one side of a governance boundary, and copied its
  project ref, organisation ID and region into this repo. The operator
  corrected it. The rule now written into §2.1 is the lesson: **an unexpected
  project in a connector listing is a misconfiguration, never a discovery** —
  stop and re-check the connection instead of reasoning about why it might be
  relevant. No data in either system was touched.

  **The test pastor account stays — do not remove it.** `rf_pastors` holds
  exactly one row: a test pastor on a `@thewellfitcommunity.org` address
  (created 2026-05-14, working login). An earlier draft of this entry called
  it a stray artifact due for deletion. The operator corrected that on
  2026-08-28: it is deliberate and needed. It is also the **only** pastor in
  the network, so deleting it would leave an empty bishop dashboard, and it is
  the only way to exercise pastor-scoped RLS — the bishop's **View App**
  renders the pastor UI while still carrying a bishop JWT, so `is_bishop()`
  stays true and `pastor_id_for_current_user()` resolves differently. Migration
  `20260515173803` exists because this account surfaced a soft-delete RLS bug
  no bishop session would have hit (commit `f85c6c7`). The foreign email
  domain is cosmetic; no credential or data crosses systems. Revisit at
  handoff, not before. See `governance-boundaries.md` §4.
- ~~Two memory files cited by every guard violation message do not exist.~~
  **Written 2026-08-28.** `feedback_no_demo_grade_code.md` documents the five
  hard-blocked patterns and why each was banned (all five were shipped here
  once and remediated under SEC-1…SEC-16); `feedback_audit_logger_only.md`
  documents both `audit()` signatures — client `audit(eventType, meta)` and
  edge `audit(supa, eventType, meta)` — and why `console.*` is refused. Both
  live **in the repo** at `memory/`, which is where the hook messages already
  pointed (`See memory/feedback_no_demo_grade_code.md`) and means a human
  contributor who trips the guard can actually read them. They are covered by
  the scanner's `*/memory/*` exemption, which they need: they quote the banned
  strings verbatim.
- ~~`SB_SECRET_KEY` holds a publishable key.~~ **FIXED 2026-08-28 by the user.**
  Proven before the fix and verified after, both from `supabase secrets list`,
  which returns a plain SHA-256 of each value. Proof of the defect was a hash
  preimage match: SHA-256 of the `sb_publishable_…` key read straight out of
  `kg-pastoral-network.html` equals `87d76609…c92cae`, the digest then reported
  for `SB_SECRET_KEY`. The variable literally held the string the browser
  downloads on every page load. That confirmed the 2026-08-14
  diagnostic-function finding by a second, independent route.

  After the fix `SB_SECRET_KEY` reports `e78a09f5…`, identical to
  `SUPABASE_SERVICE_ROLE_KEY` — the strongest available evidence it is valid,
  since that is the key already doing all the real work in production. This is
  exactly the arrangement `REFORMATION_ROADMAP.md` I1 asked for: both variables
  populated with genuine secret keys, so `SUPABASE_SERVICE_ROLE_KEY ??
  SB_SECRET_KEY` can no longer collapse to anon privileges if the first is ever
  absent. No redeploy was needed — the first variable is unchanged, so runtime
  behaviour is byte-identical.

- **`SUPABASE_ANON_KEY` also holds the publishable key — and the reason is
  unknown. Do not assume it is fine.** An earlier draft of this section
  asserted that Supabase injects the publishable key into that variable now
  that the legacy anon JWT is retired. **That claim is unsupported and was
  removed.** The docs
  ([Migrating to publishable and secret API keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys))
  say the platform *adds* `SUPABASE_PUBLISHABLE_KEYS` and
  `SUPABASE_SECRET_KEYS` **alongside** the legacy `SUPABASE_ANON_KEY` and
  `SUPABASE_SERVICE_ROLE_KEY` — they are two different keys, anon being a JWT
  signed by the project's JWT secret and publishable an opaque
  `sb_publishable_…` that rotates independently.

  Severity is genuinely lower than the `SB_SECRET_KEY` case and should not be
  conflated with it. Three functions read it —
  `kgfcm-pin-login:25`, `kgfcm-pin-register:26`, `kgfcm-pin-reset-confirm:27`,
  all as `SUPABASE_ANON_KEY ?? SB_PUBLISHABLE_KEY` — and the docs state the
  publishable key "carries the same low privileges as the `anon` key", so this
  is a **mislabel at the same privilege level**, not a downgrade. Logins work.

- **Twelve functions still read no new-model variable.** `SUPABASE_PUBLISHABLE_KEYS`
  and `SUPABASE_SECRET_KEYS` are both present in the project's secrets and
  **zero functions read either**. Migrating onto them is Step 4 / Option 1 of
  the migration guide and would retire every `?? SB_*` fallback chain, ending
  the ambiguity about which variable holds what. This is now the substantive
  remainder of I1.

- Carried forward unchanged: the `pg_net` cron auth redesign and the A1/A2
  white-label work. See the NEXT UP section and `REFORMATION_ROADMAP.md` I1.
  The docs confirm the deadline I1 records: legacy `anon` and `service_role`
  keep working **until the end of 2026**.

### G. `RUN_THIS_IN_SUPABASE.sql` deleted — do not restore it

The ship-day script was run once on 2026-04-12 and has been superseded in
every part but one. Audited against live on 2026-08-28:

| § | What it did | State when deleted |
|---|---|---|
| 1 | `add column rf_wins.image_data` | Gone — renamed to `image_url` by SEC-9 |
| 1 | `rf_outreach_profiles` + four anon `using(true)` policies | Table kept; policies replaced by `outreach_self_insert/read/update` (SEC-3) |
| 2 | `wins` bucket public + `wins_public_read`/`wins_anon_insert`/`wins_anon_update` | Bucket kept; all three anon policies dropped (SEC-15, SEC-3) |
| 3 | Photo URLs → `/Bishop%20Sasser.jpg` Vercel paths | Keys hold `…supabase.co/storage/…` URLs instead |
| 4 | Parchment cream theme | **Still live** — the only surviving section |

**Why it had to go rather than be corrected.** It was written as an
instruction (`Run this entire file in the Supabase SQL Editor`) and three
handoff checklists in this file still pointed at it. Executed today it
would re-add the column SEC-9 removed, re-create four anon `using(true)`
policies on a table holding ministry data, restore the bucket-enumeration
policies SEC-15 dropped, overwrite the photo URLs with Vercel paths that
no longer resolve, and close by telling the operator to deploy
`kgfcm-ai-proxy --no-verify-jwt`. Four completed security items, reversed
by following the documentation.

Nothing was lost. §1 lives in `20260412000300_wins_images_outreach.sql`,
§2's bucket in the storage migrations, and §3–§4 are `rf_network_config`
rows that are live and correct. Migrations are CLI-only now (section D),
so a SQL-editor paste file has no place in the workflow regardless.

References to it survive in the superseded 2026-04-12 and 2026-08-14
handoff sections below. Those are kept as history; the file they name is
gone and must not be reconstructed from them.

### H. Outbound email — the domain is send-only, and two defects follow

`kingdomgracefamily.com` is configured for Resend sending and nothing else.
Resolved 2026-08-28 over DNS-over-HTTPS:

| Record | Value |
|---|---|
| `kingdomgracefamily.com` MX | **none** |
| `kingdomgracefamily.com` TXT | none (no apex SPF — correct; SPF lives on the `send.` subdomain) |
| `_dmarc.kingdomgracefamily.com` TXT | `v=DMARC1; p=none` — **added 2026-08-28**, see H2 |
| `resend._domainkey` TXT | `p=MIGfMA0GCSq…` (DKIM, verified) |
| `send.kingdomgracefamily.com` MX | `feedback-smtp.us-east-1.amazonses.com` |
| `send.kingdomgracefamily.com` TXT | `v=spf1 include:amazonses.com ~all` |

That is Resend's standard verified-domain setup. It means
`noreply@kingdomgracefamily.com` is a from-address inside Resend's API, not a
mailbox: there is no inbox, no credentials, and nothing to sign in to. Sending
anything from the ministry's own domain requires either the `RESEND_API_KEY`
(a Supabase secret, readable only as a digest) or a real mailbox on the domain.

**H1 — Every PIN and reset email is unreplyable, silently.** `RESEND_FROM` is
**not set** as a secret, so `kgfcm-admin-pin-issue:57` and
`kgfcm-pin-reset:29` both fall back to the hardcoded
`Kingdom Grace <noreply@kingdomgracefamily.com>`. With no MX on the apex, a
reply to that address does not bounce to anyone — it simply fails. A pastor or
admin who receives a PIN, hits trouble, and replies is shouting into a void,
and nobody learns they tried. This is a pastoral-care defect as much as a
technical one: the people most likely to reply are the ones already stuck at
the door. Fix is either a real mailbox (below) or a `RESEND_FROM` /
`Reply-To` pointing somewhere a human reads.

**H2 — ~~No DMARC record.~~ FIXED 2026-08-28.** The apex published no DMARC
policy while Microsoft weights DMARC when filtering, and Outlook/Hotmail is
exactly where these have to land — the one provisioned admin is on
`hotmail.com`. `v=DMARC1; p=none` now published at
`_dmarc.kingdomgracefamily.com`, verified resolving from both Google and
Cloudflare public resolvers. The domain now has the full trio: DKIM
(`resend._domainkey`), SPF (`send.` subdomain), DMARC (apex).

**Why `p=none` and not something stricter.** Alignment already passes —
Resend signs DKIM as the apex domain, and the SPF return-path is
`send.kingdomgracefamily.com`, a subdomain, which satisfies DMARC's default
relaxed alignment. So `p=quarantine` would not reject legitimate mail today.
It was not chosen because there is nowhere to send aggregate reports: a `rua=`
pointing at a Gmail address only works if `gmail.com` publishes an
authorisation record for this domain, which is not something we can add.
Without reports, a future alignment break would send PINs to spam silently.
`p=none` gets the record receivers look for at zero risk. Tighten to
`p=quarantine` once a real mailbox exists on the domain (see below) and `rua`
can point somewhere that receives.

**DNS is managed by Vercel** (`ns1`/`ns2.vercel-dns.com`). Note for next time:
the Vercel MCP connector covers deployments, projects and domain *purchase*
but exposes **no DNS-record tool**, and the Vercel CLI inside a dev container
is a separate credential store from any local login. For one record, the
dashboard is faster than authenticating a CLI.

**What still closes H1:** stand up a real mailbox on the domain (Google
Workspace or Microsoft 365), add MX, and point `RESEND_FROM` at an address
that can receive replies. That also gives the network a sending identity for
ordinary correspondence — on 2026-08-28 a note to the provisioned admin had to
go out from the developer's personal Gmail because no ministry address exists
to send from — and it unblocks tightening DMARC to `p=quarantine` with a
working `rua`.

**Do not** solve this by adding a general-purpose "send arbitrary email" edge
function. The two existing senders are narrowly scoped to PINs and reset codes
on purpose; a generic mailer inside a production auth system is a larger
liability than the gap it closes.

### I. `kgfcm-deploy-smoke-test` deleted — and it redeployed everything else

The retired stub is gone. It was a 410 responder that read nothing from the
environment and whose own header said it was safe to delete; nothing in the
repo referenced it and no cron job called it. Deployed functions now number
**12, matching the repo one-for-one.**

**The deletion also redeployed all twelve remaining functions.** All twelve
jumped exactly +3 versions with an identical `updated_at`, and their
`entrypoint_path` changed from `/tmp/user_fn_…` to
`file:///app/supabase/functions/…` — one bulk operation, sourced from the repo.

**Cause: the command was run as `yes | supabase functions delete …`,** to keep
an interactive prompt from hanging a non-interactive shell. `yes` answers every
question a tool asks, including ones never displayed. A single-function delete
became a whole-project redeploy of a production auth system. **Do not pipe
`yes` into a destructive command here.** Run it plainly and read the prompt, or
use the tool's own scoped non-interactive flag.

**Verified immediately afterwards, all green:** `kgfcm-pin-login` returns 401
with its constant-time padding intact; CORS still echoes only the apex and
rejects an unknown origin; `kgfcm-audit` returns 401 unauthenticated; and all
twelve `verify_jwt` flags match the pre-deletion state exactly, including the
four `false` PIN endpoints. Nothing broke.

**What could not be verified:** whether the *previous* bundles differed from
the repo. They are unrecoverable. A dashboard hot-edit that was never committed
would have been overwritten. Evidence says that is unlikely — before deletion
`kgfcm-admin-pin-issue` stood at v3, and commit `2d0b5dc` records "Deployed v3,
verified in production", so the deployment had been tracking the repo.

**Verification trap for next time:** `supabase functions download` returns the
**compiled JavaScript**, not the TypeScript source. Diffing it against
`supabase/functions/*/index.ts` reports every file as different — types erased,
`interface` blocks gone, object literals reformatted — which proves nothing.
Compare behaviour and `verify_jwt` flags instead.

### J. `create_user: false` — the hinge of the whole auth model

This was documented only in a code comment. It is the single decision that
makes this app's login behave differently from a stock Supabase project, and
it surprises anyone who has built on Supabase before, so it belongs here.

**What the flag does.** `POST /auth/v1/otp` (`sendMagicLink()`,
`kg-pastoral-network.html:865`) is the endpoint that emails either a magic link
or a numeric code — the same endpoint, with the email template deciding which.
By default, when the address has no `auth.users` row, GoTrue **creates one**
and then sends. That is self-serve signup-by-email. Passing
`create_user: false` refuses instead: `422 otp_disabled`, no account, no email.

**The consequence, stated plainly.** An `auth.users` row is only ever minted by
`ensureAuthUser()` during a successful PIN login. So:

```
email + PIN  →  auth.users row created  →  magic link works from then on
```

**A magic link can never be anyone's first way in.** For a new person it always
fails. `kg-pastoral-network.html:882` catches that specific error and says so:
"Sign in with your email and PIN first."

**Why it is set that way.** Membership is bishop-controlled: a person exists
because an `rf_pastors` or `rf_admins` row exists, and the auth row shadows it.
Self-serve OTP signup would let anyone who types any address mint an auth user.

Be precise about the stakes — this is **not** an access-control guard. A
GoTrue-created OTP user carries no `app_metadata.role`, and every RLS policy
keys on `is_bishop()` or `pastor_id_for_current_user()`, so such a user would
see nothing. `ensureAuthUser()` also adopts any pre-existing row for the email
and overwrites `app_metadata.role` from the profile table, so an account
squatted in advance is not an escalation path either. What the flag actually
prevents is `auth.users` filling with profile-less accounts, strangers burning
the Supabase Auth email quota, and the roster ceasing to describe who is really
in the network.

**The cost is real and was felt on 2026-08-28:** nobody can bootstrap
themselves. Someone must issue the first PIN. That flow exists and works —
`kgfcm-admin-pin-issue` generates a 6-digit CSPRNG PIN, bcrypts it and emails
it via Resend (the Bishop's **Email PIN** button in the Admins tab). It is the
same "system sends a code for first login" pattern other Supabase projects get
from GoTrue OTP, just built on this project's own PIN table instead.

> **Do not "modernise" this to `should_create_user`.** The code comment at
> `:863` records that the newer key is **ignored** by this project's GoTrue,
> and the endpoint then falls back to *creating* the user. Renaming it would
> silently switch self-serve signup on across a closed pastoral network, and
> nothing would fail loudly to signal it.

**If self-service is ever wanted**, the change is a deliberate design decision,
not a flag flip: it needs a gate deciding who may mint an account — an invite
token, a bishop-approved allowlist, or a domain restriction — because
`create_user: true` on its own admits everyone.

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
- ~~**Delete the `kgfcm-deploy-smoke-test` function.**~~ **DONE 2026-08-28.**
  Was a 410 stub reading nothing from the environment. See section I — the
  deletion had an unintended side effect worth reading before deleting another.
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
| SEC-2 | Replace `Math.random()` reset codes + `btoa(...)` invite tokens with CSPRNG | — | **DONE 2026-05-13** | Final HTML grep returns zero Math.random / security-context btoa. Reset codes now generated by `kgfcm-pin-reset` via `generateCode()` (CSPRNG, 8 hex chars). Invite tokens via `crypto.randomUUID()`. Admin creation `pin_hash: btoa(pin)` replaced by `create_admin()` SECURITY DEFINER RPC with bcrypt. (Remaining `btoa()` in HTML is the WebAuthn credential.rawId base64 encoding — legitimate bytes-to-text use.) |
| SEC-3 | Tighten RLS — remove `anon using(true)/with check(true)`, require JWT | CRITICAL | **DONE 2026-05-13** | All old `using(true)` anon policies dropped. New policies key on `auth.uid()` and `is_bishop()` (JWT app_metadata.role). Column-level GRANT excludes pin_bcrypt + reset_token_hash. Post-migration assertion: zero open anon writes remain. |
| SEC-4 | Email/SMS delivery for reset codes — stop echoing to browser | — | **DONE 2026-05-13** | Two new edge functions: `kgfcm-pin-reset` (sends 8-char CSPRNG code via Resend, stores SHA-256 hash in `reset_token_hash`, constant-time `{sent:true}` response regardless of email-existence — enumeration defense) and `kgfcm-pin-reset-confirm` (verifies hash, bcrypts new PIN, issues session for auto-login). Bishop's reset-pastor/reset-admin buttons now trigger the same email flow; bishop never sees a code. Code never echoes to the browser. **Action: set `RESEND_API_KEY` and `RESEND_FROM` Supabase secrets** for delivery; without them the function still hashes and stores correctly but the email send is a no-op (audited as `delivered:false`). |
| SEC-5 | JWT-verify all edge functions, lock CORS to production origin | — | **DONE 2026-05-13** | All 4 legacy fns (kgfcm-ai-proxy, kgfcm-push-send, kgfcm-push-notify, kgfcm-checkin-remind) redeployed with `verify_jwt: true` and the shared CORS module. Unauthenticated calls now rejected by Supabase's edge runtime before our code runs. kgfcm-push-send accepts service_role (server-to-server) or bishop/admin JWT only; rejects pastor JWT with audit log. kgfcm-ai-proxy rate-limits per user via rf_reset_attempts. Login/register kept `verify_jwt: false` (PIN flow has no JWT yet) but do their own rate-limit + constant-time. Lock CORS to production by setting `ALLOWED_ORIGINS` Supabase env var to the Vercel domain. **Done 2026-05-14 — this trailing sentence is history, not a to-do.** It reads as an open action and was misread as one on 2026-08-28; the variable is set to the apex plus `www`, verified by preflight probe. See the correction in section F. |
| SEC-6 | Server-side audit logger via service-role edge function | — | **DONE 2026-05-13** | New kgfcm-audit edge function deployed (verify_jwt: true). Client `audit()` in HTML routes through it; actor_id/actor_role come from the verified JWT, not client claim. All 5 `console.error` calls in legacy fns replaced with `audit()`. Verified: SMOKE_TEST audit row from bishop JWT recorded `actor_role: bishop` server-derived. |
| SEC-7 | Add CSP header in vercel.json | — | **DONE 2026-05-13** | Strict CSP with default-src 'self', script-src 'self' 'unsafe-inline' (HTML has inline scripts + onclick handlers), style-src + font-src for Google Fonts, img-src + connect-src locked to the project's Supabase domain, frame-ancestors 'none', upgrade-insecure-requests. Plus HSTS (Strict-Transport-Security: max-age=63072000 includeSubDomains preload). |
| SEC-8 | Remove redundant long-lived anon JWT from HTML | — | **DONE 2026-05-13** | Legacy `supabaseAnonKey` removed from kg-pastoral-network.html config block; `supabaseKey` getter + `SB_API_KEY` simplified to publishable key only. One fewer long-lived secret in the bundle. |
| SEC-9 | Migrate `image_data` base64 columns to storage bucket | — | **DONE 2026-05-13** | Migration 20260513180000 renames `image_data` → `image_url` on rf_wins and rf_announcements (zero rows had non-null image_data — pure rename, no data carry). HTML uses the new name. Already wrote bucket URLs into the column; now the column name matches reality. |
| SEC-10 | Idempotency keys on offline-queue mutations | — | **DONE 2026-05-13** | HTML `SB_HDR` attaches a fresh `Idempotency-Key: <crypto.randomUUID()>` on every mutation. sw.js preserves the header on queue and tracks completed keys in IndexedDB v2 `processed_keys` store; replays skip keys already acknowledged. Prevents the "server accepted but client lost the response" dup case. |
| SEC-11 | Wire `.githooks/pre-commit` — set `core.hooksPath` | HIGH | **DONE 2026-08-28** | `git config core.hooksPath .githooks` is set; hook is executable. Until this session it had never run, which also means the `sw.js` CACHE_NAME auto-bump never fired — every HTML-only commit shipped without a service-worker cache bust. Both are live now. The one file that failed the guard, `supabase/RUN_THIS_IN_SUPABASE.sql`, has since been deleted — see section G. |
| SEC-12 | Reload Claude hooks via `/hooks` (USER ACTION) | — | **DONE** | Hooks have been firing throughout the session (caught CORS-wildcard, SQL-anon, and HEREDOC false positives along the way — all refined). |
| SEC-13 | rf_push_subscriptions ALL policy wide-open to `public` | — | **DONE 2026-05-13** | Replaced with self-only CRUD keyed on `user_id = auth.uid()::text`. Bishop can read all via `is_bishop()`. |
| SEC-14 | reset_weekly_post_counts SECURITY DEFINER + anon-executable + mutable search_path | — | **DONE 2026-05-13** | EXECUTE revoked from anon/authenticated/public; search_path pinned to `public, pg_temp`. |
| SEC-15 | Public bucket SELECT-list policies | — | **DONE 2026-05-13** | `wins_public_read`, `voice_public_read`, `public_read_avatars`, `public_read_announcements` dropped. Direct URL fetch still works; bucket enumeration does not. |
| SEC-16 | Capture orphan MCP-applied migrations as files | — | **DONE 2026-05-13** | `20260412210000_consolidated_pre_auth.sql` captures the schema for rf_audit_log, rf_admins, rf_network_config plus the rf_pastors.reset_token columns. Idempotent (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / ON CONFLICT DO NOTHING). A fresh `supabase db reset` against the repo migrations now reconstructs the live schema. **Regressed and re-fixed 2026-08-28** — two migrations applied on 2026-05-15 never got repo files, so the claim had quietly become false. Both recovered from the ledger and the whole history reconciled; see section A at the top of this file. |

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

1. ~~Run `supabase/RUN_THIS_IN_SUPABASE.sql` in the Supabase SQL Editor (applies migration, photo URLs, warm theme, wins storage bucket).~~ **File deleted 2026-08-28 — do not run. See section G.**
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
