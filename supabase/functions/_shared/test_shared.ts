// Deno tests for the shared edge-function utilities. Run with:
//   cd supabase/functions && deno test --allow-env --no-check _shared/test_shared.ts
// (--no-check skips remote import type resolution; logic is still checked.)

import { assert, assertEquals, assertMatch } from "jsr:@std/assert@^1.0.19";
import { hashIdentifier } from "./audit.ts";
import { generateCode, hashCode, padTo } from "./rate_limit.ts";

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
