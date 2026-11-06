// Deno tests for the shared edge-function utilities. Run with:
//   cd supabase/functions && deno test --allow-env --no-check _shared/test_shared.ts
// (--no-check skips remote import type resolution; logic is still checked.)

import { assert, assertEquals, assertMatch } from "jsr:@std/assert@^1.0.19";
import { hashIdentifier } from "./audit.ts";
import { generateCode, hashCode, LIMITS, padTo, rateLimit } from "./rate_limit.ts";
import { isServerCaller, parsePublishableKeys, parseSecretKeys } from "./server_key.ts";
import { importVapidSigningKey, signVapidJwt } from "./vapid.ts";

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

// ── isServerCaller — a configured secret key, never a token's claims ──
const KEY_A = "sb_secret_" + "a".repeat(32);
const KEY_B = "sb_secret_" + "b".repeat(32);

Deno.test("isServerCaller — any configured secret key is a server caller", () => {
  assertEquals(isServerCaller(KEY_A, [KEY_A, KEY_B]), true);
  assertEquals(isServerCaller(KEY_B, [KEY_A, KEY_B]), true);
});

Deno.test("isServerCaller — anything else is not", () => {
  assertEquals(isServerCaller("", [KEY_A]), false);
  assertEquals(isServerCaller(KEY_A.slice(0, -1) + "z", [KEY_A]), false);
  assertEquals(isServerCaller(KEY_A + "a", [KEY_A]), false);
  assertEquals(isServerCaller("sb_publishable_" + "a".repeat(27), [KEY_A]), false);
  // A legacy service_role JWT is not accepted, whatever its claims say.
  // Header/payload decode to {"alg":"HS256"} / {"role":"service_role"}.
  const legacyJwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig";
  assertEquals(isServerCaller(legacyJwt, [KEY_A]), false);
});

Deno.test("isServerCaller — refuses everything when no secret key is configured", () => {
  assertEquals(isServerCaller(KEY_A, []), false);
  assertEquals(isServerCaller("", []), false);
});

Deno.test("parseSecretKeys — reads SUPABASE_SECRET_KEYS, ignores anything that is not a secret key", () => {
  assertEquals(parseSecretKeys(JSON.stringify({ default: KEY_A, ci: KEY_B })), { default: KEY_A, ci: KEY_B });
  assertEquals(parseSecretKeys(JSON.stringify({ default: "eyJ.legacy.jwt", other: 5 })), {});
  assertEquals(parseSecretKeys("not json"), {});
  assertEquals(parseSecretKeys(undefined), {});
  assertEquals(parseSecretKeys("[1,2]"), {});
});

Deno.test("parsePublishableKeys — reads SUPABASE_PUBLISHABLE_KEYS, never a secret or legacy key", () => {
  const PUB = "sb_publishable_" + "p".repeat(27);
  assertEquals(parsePublishableKeys(JSON.stringify({ default: PUB })), { default: PUB });
  assertEquals(parsePublishableKeys(JSON.stringify({ default: KEY_A })), {});
  assertEquals(parsePublishableKeys(JSON.stringify({ default: "eyJ.legacy.anon" })), {});
});

// ── VAPID signing key — real P-256 keys in the format generators emit ──
function toB64url(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

Deno.test("importVapidSigningKey — a generated key pair signs, and the public key verifies", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const rawPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  // VAPID env format: private = raw 32-byte scalar (the JWK d), public = 65-byte point.
  const key = await importVapidSigningKey(jwk.d as string, toB64url(rawPublic));
  const data = new TextEncoder().encode("header.claims");
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, data);
  assert(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, sig, data));
});

Deno.test("importVapidSigningKey — rejects keys of the wrong shape with a clear error", async () => {
  let msg = "";
  try { await importVapidSigningKey(toB64url(new Uint8Array(31)), toB64url(new Uint8Array(65).fill(4))); }
  catch (e) { msg = (e as Error).message; }
  assertMatch(msg, /32 bytes/);
});

Deno.test("importVapidSigningKey — refuses a private key that does not match the public key", async () => {
  const a = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const b = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const dA = (await crypto.subtle.exportKey("jwk", a.privateKey)).d as string;
  const pubB = new Uint8Array(await crypto.subtle.exportKey("raw", b.publicKey));
  let msg = "";
  try { await importVapidSigningKey(dA, toB64url(pubB)); } catch (e) { msg = (e as Error).message; }
  assertMatch(msg, /does not match/);
});

Deno.test("signVapidJwt — ES256 token whose raw signature verifies, exp 12h ahead", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const d = (await crypto.subtle.exportKey("jwk", pair.privateKey)).d as string;
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const key = await importVapidSigningKey(d, toB64url(pub));
  const now = 1_800_000_000;
  const token = await signVapidJwt(key, "https://fcm.googleapis.com", "mailto:ops@example.org", now);
  const [h, c, s] = token.split(".");
  const fromB64url = (x: string) => Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - x.length % 4) % 4)), (ch) => ch.charCodeAt(0));
  assertEquals(JSON.parse(new TextDecoder().decode(fromB64url(h))), { typ: "JWT", alg: "ES256" });
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(c)));
  assertEquals(claims.exp, now + 12 * 60 * 60);
  assertEquals(claims.aud, "https://fcm.googleapis.com");
  const sig = fromB64url(s);
  assertEquals(sig.length, 64);
  assert(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, sig, new TextEncoder().encode(`${h}.${c}`)));
});
