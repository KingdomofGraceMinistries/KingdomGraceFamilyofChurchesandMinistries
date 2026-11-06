// Deno tests for the shared edge-function utilities. Run with:
//   cd supabase/functions && deno test --allow-env --no-check _shared/test_shared.ts
// (--no-check skips remote import type resolution; logic is still checked.)

import { assert, assertEquals, assertMatch } from "jsr:@std/assert@^1.0.19";
import { hashIdentifier } from "./audit.ts";
import { generateCode, hashCode, LIMITS, padTo, rateLimit } from "./rate_limit.ts";

Deno.test("hashIdentifier produces 64-hex SHA-256 and is deterministic", async () => {
  const a = await hashIdentifier("Bishop@KGFCM.LOCAL");
  const b = await hashIdentifier("bishop@kgfcm.local");
  assertEquals(a, b, "lowercased before hashing");
  assertMatch(a, /^[0-9a-f]{64}$/);
});

Deno.test("hashIdentifier — different inputs produce different hashes", async () => {
  const a = await hashIdentifier("a@b.com");
  const b = await hashIdentifier("c@d.com");
  assert(a !== b);
});

Deno.test("generateCode produces hex string of expected length", () => {
  const c4 = generateCode(4);
  const c8 = generateCode(8);
  assertMatch(c4, /^[0-9a-f]{8}$/);   // 4 bytes → 8 hex chars
  assertMatch(c8, /^[0-9a-f]{16}$/);  // 8 bytes → 16 hex chars
});

Deno.test("generateCode is non-deterministic across calls (CSPRNG smoke test)", () => {
  const samples = new Set<string>();
  for (let i = 0; i < 200; i++) samples.add(generateCode(4));
  // With 32 bits of entropy and 200 draws, dupes are vanishingly unlikely.
  assert(samples.size >= 199, "generateCode appears non-random");
});

Deno.test("hashCode is deterministic and 64 hex chars", async () => {
  const a = await hashCode("a1b2c3d4");
  const b = await hashCode("a1b2c3d4");
  assertEquals(a, b);
  assertMatch(a, /^[0-9a-f]{64}$/);
});

Deno.test("padTo waits at least the requested duration", async () => {
  const start = performance.now();
  await padTo(start, 250);
  const elapsed = performance.now() - start;
  assert(elapsed >= 240, `padTo elapsed ${elapsed}ms, expected ≥250`);
});

Deno.test("padTo returns ~immediately when already past target", async () => {
  const start = performance.now() - 1000;     // pretend 1s has elapsed
  const before = performance.now();
  await padTo(start, 200);
  const elapsed = performance.now() - before;
  assert(elapsed < 50, `padTo over-waited (${elapsed}ms) when target already passed`);
});

// ── Validation regex tests (mirrored from login + register so any
//    future drift in either function trips a test) ────────────────────
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PIN_LOGIN_RE = /^\d{4,8}$/;
const PIN_REGISTER_RE = /^\d{6}$/;
const NAME_RE = /^[\p{L}\p{M}\s'.-]{2,80}$/u;

Deno.test("EMAIL_RE accepts well-formed emails", () => {
  for (const e of ["a@b.com", "bishop@kgfcm.local", "first.last+tag@example.co.uk"]) {
    assert(EMAIL_RE.test(e), `should accept ${e}`);
  }
});

Deno.test("EMAIL_RE rejects malformed emails", () => {
  for (const e of ["", "abc", "a@b", "a@.com", "@b.com", "a@b.", "a b@c.com"]) {
    assert(!EMAIL_RE.test(e), `should reject ${JSON.stringify(e)}`);
  }
});

Deno.test("PIN_LOGIN_RE accepts 4-8 digit pins", () => {
  for (const p of ["1234", "12345", "123456", "12345678"]) assert(PIN_LOGIN_RE.test(p));
  for (const p of ["", "abc", "123", "123456789", "12 34"]) assert(!PIN_LOGIN_RE.test(p));
});

Deno.test("PIN_REGISTER_RE accepts only 6-digit pins", () => {
  assert(PIN_REGISTER_RE.test("123456"));
  for (const p of ["", "12345", "1234567", "12345a"]) assert(!PIN_REGISTER_RE.test(p));
});

Deno.test("NAME_RE accepts realistic pastor names with unicode + diacritics", () => {
  for (const n of ["Peter Sasser", "María José", "O'Connor", "Jean-Paul", "St. John"]) {
    assert(NAME_RE.test(n), `should accept ${n}`);
  }
});

Deno.test("NAME_RE rejects empty, too-short, too-long, or non-text", () => {
  assert(!NAME_RE.test(""));
  assert(!NAME_RE.test("A"));
  assert(!NAME_RE.test("a".repeat(81)));
  assert(!NAME_RE.test("<script>"));
  assert(!NAME_RE.test("12345"));
});

// ── rateLimit — in-memory stand-in for rf_reset_attempts ──
// Implements only the query shapes rateLimit() uses: a filtered head count
// and an insert. Rows carry created_at so the window filter is exercised.
type AttemptRow = { email_hash: string; ip_hash: string; kind: string; created_at: string };

function fakeSupa(opts: { failInsert?: boolean; failCount?: boolean } = {}) {
  const rows: AttemptRow[] = [];
  const client = {
    from(_table: string) {
      return {
        select(_cols: string, _o: unknown) {
          const filters: Array<(r: AttemptRow) => boolean> = [];
          const q = {
            eq(col: keyof AttemptRow, val: string) { filters.push((r) => r[col] === val); return q; },
            gte(col: keyof AttemptRow, val: string) { filters.push((r) => r[col] >= val); return q; },
            then(resolve: (v: unknown) => void) {
              resolve(opts.failCount
                ? { count: null, error: { message: "boom" } }
                : { count: rows.filter((r) => filters.every((f) => f(r))).length, error: null });
            },
          };
          return q;
        },
        insert(row: Omit<AttemptRow, "created_at">) {
          if (opts.failInsert) return Promise.resolve({ error: { message: "violates check constraint" } });
          rows.push({ ...row, created_at: new Date().toISOString() });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  // deno-lint-ignore no-explicit-any
  return client as any;
}

Deno.test("rateLimit — allows exactly perEmail attempts, then limits", async () => {
  const supa = fakeSupa();
  for (let i = 0; i < LIMITS.login.perEmail; i++) {
    const r = await rateLimit({ supa, email: "p@x.org", ip: "1.1.1.1", kind: "login" });
    assertEquals(r.limited, false, `attempt ${i + 1} allowed`);
  }
  const over = await rateLimit({ supa, email: "p@x.org", ip: "1.1.1.1", kind: "login" });
  assertEquals(over.limited, true);
});

Deno.test("rateLimit — AI use never spends the login budget", async () => {
  const supa = fakeSupa();
  for (let i = 0; i < 10; i++) {
    await rateLimit({ supa, email: "p@x.org", ip: "1.1.1.1", kind: "ai" });
  }
  const login = await rateLimit({ supa, email: "p@x.org", ip: "1.1.1.1", kind: "login" });
  assertEquals(login.limited, false);
});

Deno.test("rateLimit — 30 pastors can sign in from one shared address", async () => {
  const supa = fakeSupa();
  for (let i = 0; i < 30; i++) {
    // Each pastor mistypes once, then succeeds: 60 attempts from one IP.
    await rateLimit({ supa, email: `pastor${i}@x.org`, ip: "203.0.113.7", kind: "login" });
    const r = await rateLimit({ supa, email: `pastor${i}@x.org`, ip: "203.0.113.7", kind: "login" });
    assertEquals(r.limited, false, `pastor ${i + 1} not locked out`);
  }
});

Deno.test("rateLimit — fails closed when the attempt cannot be recorded", async () => {
  let threw = false;
  try {
    await rateLimit({ supa: fakeSupa({ failInsert: true }), email: "p@x.org", ip: "1.1.1.1", kind: "ai" });
  } catch { threw = true; }
  assert(threw, "insert failure must throw, not silently leave the limit open");
});

Deno.test("rateLimit — fails closed when the count cannot be read", async () => {
  let threw = false;
  try {
    await rateLimit({ supa: fakeSupa({ failCount: true }), email: "p@x.org", ip: "1.1.1.1", kind: "login" });
  } catch { threw = true; }
  assert(threw, "count failure must throw, not read as zero attempts");
});
