# Governance Boundaries

**Last updated:** 2026-08-28
**Scope:** Kingdom Grace Pastoral Network only.

`CLAUDE.md` has referenced this file since the repo's first commit, promising a
map of "System A (WellFit) vs System B (Envision Atlus)" separation, Shared
Spine services, cross-system read paths, data ownership and refactor
guardrails. The file never existed until now.

**The promised map does not apply to this codebase.** See §3.

---

## 1. Kingdom Grace is a standalone system

It has no upstream, no downstream, and no sibling. Everything it depends on is
listed here; nothing else may be added without a deliberate decision.

| Concern | What it is |
|---|---|
| Database / Auth / Storage | One Supabase project, ref `kseocbwhuveieqhayske` |
| Frontend | One file, `kg-pastoral-network.html`, served statically |
| Hosting | Vercel team `kingdomofgraceministries-projects` |
| Domain | `kingdomgracefamily.com` (apex + `www`) |
| DNS | Vercel nameservers |
| AI | Claude API, reached only via the `kgfcm-ai-proxy` edge function |
| Outbound mail | Resend, send-only, `noreply@kingdomgracefamily.com` |

There is no shared library, shared schema, shared credential, or cross-project
connection with any other system. Verified 2026-08-28 by searching every
`*.ts`, `*.html`, `*.sql`, `*.json`, `*.toml` and `*.md` in the repo.

**Data ownership** is therefore whole and undivided: this project is the system
of record for every pastor, church, check-in, prayer request, win, message,
devotion, event, fast and audit row it holds. Ownership *within* the system is
enforced by RLS on all 21 tables, keyed on `auth.uid()` through
`pastor_id_for_current_user()` and `is_bishop()`.

---

## 2. Operative rules

### 2.1 One project, and confirm it before writing

Every write goes to `kseocbwhuveieqhayske`. Confirm the target before any
schema or data change:

```bash
npx supabase@latest projects list      # expect kseocbwhuveieqhayske
```

**This is not theoretical.** On 2026-08-28 a session began with the Supabase
connector still authenticated to an unrelated account belonging to the same
operator; `list_projects` returned that account's project and every Kingdom
Grace call returned `permission denied` until the connector was reconnected.
No data was touched, but the correct reflex when a connector lists a project
you did not expect is to **stop and re-check the connection**, not to reason
about why the unexpected project might be relevant. Treat an unexpected
project as a misconfiguration, never as a discovery.

### 2.2 No credential may span systems

The operator runs other platforms. Do not create a Supabase key, MCP
connector, service-role token, or CI secret that can reach Kingdom Grace and
another system at once. Kingdom Grace's secrets are inspectable by name, never
value:

```bash
npx supabase@latest secrets list
```

Do not copy a key between systems in either direction.

### 2.3 Migrations are CLI-only

Never apply DDL through the MCP connector. See `PROJECT_STATE.md` section D
for the rule and the ledger drift that produced it.

### 2.4 Refactor guardrails

- **Do not extract shared code toward another project.** If Kingdom Grace and
  another system need the same thing, duplicate it. A shared library couples
  two independently-owned systems and is a decision for the operator, not a
  refactor.
- **Do not rename to another system's conventions.** The `rf_` table prefix,
  the `kgfcm-` function slugs and `C.appId = "kgfcm"` are this system's
  identity. Changing the slugs is a multi-tenancy decision — see
  `PROJECT_STATE.md` A5.
- **Keep the single-file frontend.** No build step, no framework, no bundler.
  `CLAUDE.md` Architecture Rules.
- **White-labelling is not a boundary change.** Branding resolves from
  `rf_network_config` at runtime; a second tenant is a data question first and
  a slug question second.

---

## 3. The System A / System B language in CLAUDE.md is carry-over

`CLAUDE.md` names "System A (WellFit)" and "System B (Envision Atlus)". Both
belong to other work by the same operator. **Neither describes Kingdom
Grace**, and this repo has no relationship with either.

Evidence:

- The six-line block in `CLAUDE.md` is the **only** occurrence of "System A",
  "System B", "Shared Spine" or "Envision Atlus" in the entire repo. Nothing
  references it; nothing depends on it.
- It arrived in `8e191d8`, the first substantive commit, as part of the initial
  `CLAUDE.md` scaffold — not added later when someone was reasoning about
  architecture. `CLAUDE.md` also reproduces `claude-code-frequent-mistakes.md`
  verbatim, so the file is demonstrably assembled from reusable material.
- The operator confirmed on 2026-08-28 that they do not recognise the terms as
  describing this project.

**Recommended:** delete the "Governance Boundaries" bullet list from
`CLAUDE.md` and point it at this file instead. A boundary map for systems this
app has no relationship with costs a future session real time chasing a
phantom — which is exactly what happened on 2026-08-28, when an unrelated
project appearing in a misconfigured connector was mistaken for one side of
that map and written up as a boundary before the operator corrected it.

---

## 4. The test pastor account is deliberate — do not remove it

`rf_pastors` holds exactly **one** row: a test pastor on a
`@thewellfitcommunity.org` address, created 2026-05-14, with a working login.
The address belongs to another of the operator's platforms, which is why it
looks like a boundary artifact. It is not one — it is a deliberate test
account, confirmed by the operator on 2026-08-28, and **it is needed.**

**Do not delete it.** An earlier draft of this section said it should be
removed. That was wrong twice over:

1. It is the **only** pastor in the network. Removing it leaves zero — an
   empty bishop dashboard and no pastor-side anything to look at.
2. It is the only way to exercise pastor-scoped RLS. The bishop's **View App**
   renders the pastor UI but still carries a bishop JWT, so `is_bishop()`
   returns true and `pastor_id_for_current_user()` resolves differently. Every
   policy that distinguishes a pastor from staff is untested without a real
   pastor login. Migration
   `20260515173803_ann_self_read_includes_own_removed.sql` exists precisely
   because this account surfaced a soft-delete RLS bug that no bishop session
   would have hit — see commit `f85c6c7`, *"Fix pastor-side regressions caught
   in Maria test session"*.

The email domain is cosmetic. No credential, key or data crosses between
systems; it is simply an address the operator controls.

**Revisit at handoff**, not before — once real pastors are provisioned and the
network is live, decide whether the test account stays as a permanent QA login
or is retired. If it is ever retired, note that removal touches `auth.users`,
the `rf_pastors` row, and that pastor's `rf_checkins` / `rf_prayer_requests` /
`rf_wins` content rows.
