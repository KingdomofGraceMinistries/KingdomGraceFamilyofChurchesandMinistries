---
name: feedback_audit_logger_only
description: No console.* anywhere in KGFCM — every error and event goes through audit() into rf_audit_log.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: e5477329-b669-4365-9d8c-34c0047e38c6
  modified: 2026-08-28T17:16:57.507Z
---

`console.log` / `error` / `warn` / `debug` / `info` are forbidden in every
`.ts`, `.js` and `.html` file here, and `.claude/hooks/content-scan.sh` blocks
them on write and on commit. Route the event through `audit()` instead.

**Two call sites, different signatures:**

- **Client** (`kg-pastoral-network.html:1205`) — `audit(eventType, meta)`, where
  `meta` is `{table, targetId, ...rest}`. It POSTs to the `kgfcm-audit` edge
  function with the session JWT. It returns silently when there is no
  `access_token` or the token is past `expires_at`, so pre-login failures are
  not auditable from the browser — those paths live in edge functions and audit
  server-side instead.
- **Edge functions** (`supabase/functions/_shared/audit.ts`) —
  `audit(supa, eventType, meta)`, where `meta` is
  `{actor_id, actor_role, target_table, target_id, ip_address, ...rest}`,
  defaulting the actor to `system`/`service`. On insert failure it retries once
  as an `AUDIT_WRITE_FAILED` row, then drops the trace rather than crashing the
  request.

**Why:** `console.error` in an edge function goes nowhere anyone reads — it does
not survive the request, and there is no operator watching the function logs. In
the browser it is worse than useless: this app handles confessional material, so
a logged object can put a pastor's prayer request or burnout note into a shared
device's devtools. `audit()` also derives `actor_id` / `actor_role` from the
**verified JWT server-side** rather than trusting a client-supplied claim, which
is the whole point of SEC-6 — a client cannot forge who did the thing. All five
`console.error` calls in the legacy edge functions were replaced under that item.

**How to apply:** in a `catch`, call `audit()` with a descriptive `eventType`
and put the error in the metadata — then surface something to the user via
`toast()`. Never swallow the error silently and never "temporarily" add a
console line while debugging: the pre-commit hook and CI both scan, so it will
not reach main anyway.

Related: [No demo-grade code](feedback_no_demo_grade_code.md) ·
`PROJECT_STATE.md` SEC-6, which records the server-side audit cutover.
