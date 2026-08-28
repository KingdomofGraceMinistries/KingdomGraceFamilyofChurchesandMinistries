---
name: feedback_no_demo_grade_code
description: "KGFCM rejects placeholder security code outright — no base64-as-hash, no Math.random for secrets, no anon-open RLS, no \"for now\" comments."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: e5477329-b669-4365-9d8c-34c0047e38c6
  modified: 2026-08-28T17:16:41.929Z
---

Never ship stand-in security in this codebase. The user explicitly rejected the
"MVP acceptable" framing: this is a production pastoral network handling
confessional data — burnout pulses, prayer requests, DM struggles, fasting
breakthroughs — for real pastors who paid for production software.

Five patterns are hard-blocked by `.claude/hooks/content-scan.sh`, and landing
on this file usually means one of them fired:

1. **`btoa()` as a hash** — assigned to `pin_hash`/`token`/`secret`/etc., or
   called on a pin/password/secret. Base64 is reversible encoding, not a KDF.
   Use bcrypt via the `hash_pin` / `verify_pin` SECURITY DEFINER RPCs, which are
   granted to `service_role` only and reachable just from edge functions.
2. **`Math.random()`** in an auth-adjacent file or near a security keyword. Use
   `crypto.getRandomValues()` or `crypto.randomUUID()`.
3. **Deferred-fix phrasing** — "for this MVP", "for now,", "we can refactor
   later", "in production this would", "TODO: hash". The comment is the tell
   that the code underneath is a stand-in.
4. **`Access-Control-Allow-Origin: "*"`** — CORS locks to `ALLOWED_ORIGINS`.
5. **RLS policies granting `anon` with `using(true)` / `with check(true)`** —
   anon access must be conditioned on JWT claims. The one legitimate anon policy
   network-wide is `config_anon_branding_read`, a scoped SELECT on
   `rf_network_config` that excludes the pin hashes, bishop email, VAPID private
   key and Resend key.

**Why:** every one of these was actually shipped here in an earlier session and
had to be remediated under the SEC-1…SEC-16 tracker in `PROJECT_STATE.md`. The
bishop's PIN sat in the database as reversible base64 while the docs claimed it
was "hashed", and RLS was anon-open on tables holding prayer requests. The hooks
exist because the mistake already happened once.

**How to apply:** when the real fix needs server-side work you cannot inline —
a new RPC, a new edge function, a migration — STOP AND ASK rather than writing
a placeholder that "works" today. A blocked commit is cheap; a plausible-looking
stand-in that reaches a pastor's phone is not. Do not attempt to satisfy the
scanner by renaming a variable or restructuring the line: the guard is a
tripwire for the underlying design, not the syntax.

Related: [audit() only, never console.*](feedback_audit_logger_only.md) ·
`CLAUDE.md` (the 12 core rules) · `PROJECT_STATE.md` section D, which records
the companion rule that migrations go through the CLI and never the MCP.
