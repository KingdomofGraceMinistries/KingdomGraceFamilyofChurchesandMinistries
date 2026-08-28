# Governance Boundaries

**Last updated:** 2026-08-28
**Status:** Partially specified — read the caveat below before relying on this.

`CLAUDE.md` has referenced this file since the repo was created, promising a
boundary map covering System A / System B separation, Shared Spine services,
cross-system read paths, data ownership, and refactor guardrails. The file
never existed. `content-scan.sh` even exempts it by name. This is the first
version.

> ### Caveat — what is and is not authoritative here
>
> Everything under **Established** was verified directly against the running
> systems on 2026-08-28 and can be re-checked with the commands given.
>
> Everything under **Unspecified** is a question for the architect, not a
> description. WellFit's and Envision Atlus's internals were **not inspected**
> — this repo contains no code, config, credential, or comment referencing
> either beyond a single line in `CLAUDE.md`. Nothing here should be read as
> documenting their design. Writing a confident boundary map from one sentence
> would produce exactly the kind of authoritative-sounding fiction a governance
> document must never contain.

---

## 1. Established — the boundary that demonstrably exists

### 1.1 Two Supabase projects, two organisations, two credentials

| | System A — WellFit | Kingdom Grace (this repo) |
|---|---|---|
| Project ref | `xkybsjnvuohpqpbkikyn` | `kseocbwhuveieqhayske` |
| Project name | WellFit Community-Daily-Complete | KingdomofGraceMinistries's Project |
| Organisation | `uzeqxgbjillgajyjlycm` | `wvmhdxvicbffmrbdeepg` |
| Region | us-west-1 | us-east-2 |
| Created | 2025-04-29 | 2026-04-08 |

**These are not co-accessible.** This is not a policy statement — it is an
observed property of the credentials. At the start of the 2026-08-28 session
the Supabase connector was authenticated to the account owning WellFit; every
call against `kseocbwhuveieqhayske` returned `You do not have permission`, and
`list_projects` returned WellFit alone. After re-authorisation the same call
returned Kingdom Grace alone. One credential has never seen both.

**Consequence:** a cross-system query is not merely discouraged, it is
currently impossible without deliberately provisioning a credential that spans
both organisations. Do not create one to make a task easier.

### 1.2 No cross-system code paths exist

Verified by search across `*.ts`, `*.html`, `*.sql`, `*.json`, `*.toml`,
`*.md`: this repo contains **zero** references to WellFit, Envision Atlus, or a
Shared Spine, other than the `CLAUDE.md` line pointing here and the
`PROJECT_STATE.md` entry recording that this file was missing.

There is no shared library, no shared schema, no shared edge function, no
imported client, and no configured cross-project connection. The Kingdom Grace
app talks to exactly one Supabase project and one AI proxy, both listed in
`PROJECT_STATE.md` section E.

### 1.3 Separate hosting and delivery

| Concern | Kingdom Grace |
|---|---|
| Vercel team | `kingdomofgraceministries-projects` (`team_wjImZ2xATHI39kG9addV7phw`, hobby) |
| Production domain | `kingdomgracefamily.com` (apex + `www`) |
| DNS | Vercel nameservers (`ns1`/`ns2.vercel-dns.com`) |
| Outbound mail | Resend, send-only, from `noreply@kingdomgracefamily.com` |
| CORS allowlist | apex + `www` only — see `PROJECT_STATE.md` section F |

No WellFit-owned domain, team, or mail identity appears anywhere in this
project's configuration.

### 1.4 One observed cross-system artifact — needs a decision

`auth.users` in the Kingdom Grace project contains an account on a
**`@thewellfitcommunity.org`** address: role `pastor`, created 2026-05-14,
last sign-in 2026-05-15. It corresponds to the "Maria" account referenced in
the header comment of
`supabase/migrations/20260515173803_ann_self_read_includes_own_removed.sql`,
which was written to fix a soft-delete RLS bug that account surfaced.

It is almost certainly a **test account created during development**, not a
real member of the pastoral network. It is the only artifact in either system
that crosses the naming boundary.

**Action required:** confirm whether it is a test account and, if so, remove
it. A live credential on another system's domain sitting in a production
pastoral network's auth table is the kind of thing that is harmless until the
day someone has to explain it. Note that removal touches `auth.users`,
`rf_pastors`, and that pastor's `rf_checkins` / `rf_prayer_requests` rows —
scope it deliberately, do not delete casually.

---

## 2. Unspecified — questions only the architect can answer

Each of these is promised by `CLAUDE.md` and cannot be written truthfully from
anything in this repo.

### 2.1 Is Kingdom Grace inside this boundary at all?

`CLAUDE.md` names **System A (WellFit)** and **System B (Envision Atlus)**.
It does not say which — if either — Kingdom Grace belongs to.
`PROJECT_STATE.md` records the builder as **Envision VirtualEdge Group LLC**,
which is suggestive but not the same name as "Envision Atlus".

Three readings are possible and they lead to different rules:

1. Kingdom Grace **is** System B, or part of it.
2. Kingdom Grace is a **third, independent** system, and the A/B map describes
   the builder's other work.
3. The governance section of `CLAUDE.md` was **carried over from another
   project's template** and does not describe this codebase at all.

Reading 3 is plausible: `CLAUDE.md` also contains a generic
"Common AI Mistakes" section that appears verbatim in
`claude-code-frequent-mistakes.md`, indicating the file is partly assembled
from reusable material. **Until this is answered, treat sections 3–5 below as
unwritten rather than as permissive.**

### 2.2 Shared Spine services

`CLAUDE.md` promises a map of these. Nothing in this repo identifies what the
Shared Spine is, what it provides, who owns it, or whether Kingdom Grace
consumes any part of it. On present evidence Kingdom Grace consumes **none**:
its only external dependencies are its own Supabase project, the Claude API via
`kgfcm-ai-proxy`, Resend, and Vercel.

**Needed:** the list of Spine services, their owners, and their consumers.

### 2.3 Cross-system read paths

None exist in this repo (§1.2). Whether any are *intended* — for example
shared identity, shared analytics, or a common member directory — is unknown.

**Needed:** the permitted read paths, their direction, and what authorises
each. Absent that list, the operative rule is §3.1: none.

### 2.4 Data ownership rules

Within Kingdom Grace, ownership is clear and enforced by RLS: 21 tables, all
with RLS enabled, keyed on `auth.uid()` via `pastor_id_for_current_user()` and
`is_bishop()`. What is undefined is ownership of anything spanning systems —
which does not currently arise, because nothing spans them.

**Needed:** if a member, church, or event can exist in more than one system,
which system is the system of record.

---

## 3. Operative rules until §2 is answered

These follow from what is established and are safe to enforce now.

### 3.1 No cross-system access

Do not read from, write to, or join against another system's database from
this one. Do not provision a credential, connector, or service key that spans
both Supabase organisations. If a task appears to require it, **stop and ask**
— that requirement is a design decision, not an implementation detail.

### 3.2 Confirm which project you are pointed at

The credential separation in §1.1 is the safeguard, and it is only a safeguard
while nobody widens it. Before any write, confirm the target:

```bash
npx supabase@latest projects list      # expect kseocbwhuveieqhayske only
```

The Kingdom Grace project ref is pinned in `.mcp.json` and in
`PROJECT_STATE.md`. A connector that lists a project you did not expect is a
signal to stop, not to proceed carefully.

### 3.3 Migrations and schema

CLI only, never the MCP connector — see `PROJECT_STATE.md` section D for the
full rule and the drift it was written in response to.

### 3.4 No shared secrets

Each system holds its own keys. Do not copy a key, API token, or service-role
credential from one system's environment into the other's, and do not
introduce a secret store spanning both. Kingdom Grace's secrets are listed by
name (never value) via `npx supabase@latest secrets list`.

### 3.5 Refactor guardrails

- **Do not extract "shared" code across the boundary.** Duplication across two
  independently-owned systems is correct; a shared library creates a coupling
  this document cannot yet authorise.
- **Do not rename to match another system's conventions.** The `rf_` table
  prefix, `kgfcm-` function slugs, and `C.appId = "kgfcm"` are this system's.
  See `PROJECT_STATE.md` A5 — the slugs are a tenancy decision, not cosmetics.
- **Keep the single-file frontend.** `CLAUDE.md` Architecture Rules; not a
  boundary matter, but the most common unrequested refactor.
- **A boundary change is never incidental to another task.** If a piece of work
  seems to require crossing, that is the work — raise it separately.

---

## 4. How to complete this document

Answer §2.1 first; the rest is unblocked by it. If the answer is reading 3 —
that the A/B map does not describe this codebase — then say so here plainly and
delete the corresponding promise from `CLAUDE.md` rather than leaving a
reference to a boundary that does not apply. A governance document that
describes the wrong system is worse than one that admits a gap.
