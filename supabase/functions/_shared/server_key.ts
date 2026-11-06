// The project's API keys — secret (sb_secret_…) and publishable
// (sb_publishable_…) — and the check that recognises a trusted server caller
// by a secret key.
//
// Supabase retires the legacy JWT-based anon/service_role keys at the end of
// 2026. Per "Migrating to publishable and secret API keys" (Step 4) and
// "Securing Edge Functions":
//   - keys come from SUPABASE_SECRET_KEYS, a JSON object of named keys; the
//     project's main key is named "default";
//   - server callers (pg_cron/pg_net, other edge functions) send a secret key
//     on the `apikey` header only — on `Authorization: Bearer` the platform
//     tries to parse it as a JWT and rejects it;
//   - the platform's verify_jwt check only understands legacy keys, so any
//     function that server callers reach runs with verify_jwt = false and
//     authorises here, in code, against every configured secret key.
// User sessions are still JWTs; verify those with supa.auth.getClaims().

declare const Deno: { env: { get(k: string): string | undefined } };

// SUPABASE_SECRET_KEYS / SUPABASE_PUBLISHABLE_KEYS are JSON objects of named
// keys. Anything that is not a key of the expected kind is dropped.
function parseKeys(raw: string | undefined, prefix: string): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value.startsWith(prefix)) out[name] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function parseSecretKeys(raw: string | undefined): Record<string, string> {
  return parseKeys(raw, "sb_secret_");
}

export function parsePublishableKeys(raw: string | undefined): Record<string, string> {
  return parseKeys(raw, "sb_publishable_");
}

const KEYS = parseSecretKeys(Deno.env.get("SUPABASE_SECRET_KEYS"));

// The key this project's functions use for their own admin client.
export const SECRET_KEY = KEYS["default"] ?? "";

// The publishable key — the replacement for the legacy anon key — for the
// few places a function must act as an ordinary client (e.g. verifying an
// OTP the way the browser would).
export const PUBLISHABLE_KEY = parsePublishableKeys(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"))["default"] ?? "";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// True only when `apikey` exactly matches one of the configured secret keys.
// Every key is compared, so timing does not reveal which one (if any) matched.
export function isServerCaller(apikey: string, keys: string[] = Object.values(KEYS)): boolean {
  if (!apikey.startsWith("sb_secret_")) return false;
  let match = false;
  for (const k of keys) {
    if (k.startsWith("sb_secret_") && constantTimeEqual(apikey, k)) match = true;
  }
  return match;
}

// The `apikey` header, which is where server callers put the secret key.
export function apikeyOf(req: Request): string {
  return (req.headers.get("apikey") ?? "").trim();
}

// The bearer token, which for user calls is the session JWT.
export function bearerOf(req: Request): string {
  return (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

// A signed-in user's verified claims, or null. For functions deployed with
// verify_jwt = false the platform has NOT checked the token, so it must never
// be decoded without verification. getClaims() verifies the signature against
// the project's signing keys (or with Auth, for legacy HS256 tokens) and
// rejects expired tokens.
export async function verifiedUserClaims(
  supa: { auth: { getClaims: (jwt: string) => Promise<{ data: { claims: Record<string, unknown> } | null; error: unknown }> } },
  jwt: string,
): Promise<Record<string, unknown> | null> {
  if (!jwt) return null;
  const { data, error } = await supa.auth.getClaims(jwt);
  if (error || !data?.claims) return null;
  return data.claims;
}
