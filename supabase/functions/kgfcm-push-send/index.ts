// ============================================================
// kgfcm-push-send — Web Push sender (RFC 8291 aes128gcm + VAPID).
//
// Called server-to-server from kgfcm-push-notify and kgfcm-checkin-remind
// using the project's service_role JWT (which validates against
// verify_jwt:true). Also callable by a bishop JWT for direct sends.
// Anonymous and non-bishop user JWTs are rejected to prevent push spam.
//
// CORS locked via shared module. console.error → audit().
// ============================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };
import { corsHeaders, isOriginAllowed, jsonResponse } from "../_shared/cors.ts";
import { audit } from "../_shared/audit.ts";

const VAPID_PUBLIC_KEY      = Deno.env.get("VAPID_PUBLIC_KEY")          ?? "";
const VAPID_PRIVATE_KEY     = Deno.env.get("VAPID_PRIVATE_KEY")         ?? "";
const VAPID_SUBJECT         = Deno.env.get("VAPID_SUBJECT")             ?? "mailto:kgfcm2023@gmail.com";
const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")              ?? "";
const SERVICE_ROLE_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.headers.get("origin") && !isOriginAllowed(req)) {
    return jsonResponse(req, { error: "Forbidden origin" }, 403);
  }
  if (req.method !== "POST") return jsonResponse(req, { error: "Method not allowed" }, 405);

  const supa: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Authorization: service_role (server-to-server) or bishop JWT only.
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return jsonResponse(req, { error: "Missing JWT" }, 401);
  const isServiceRole = jwt === SERVICE_ROLE_KEY;
  if (!isServiceRole) {
    const { data: userData, error: userErr } = await supa.auth.getUser(jwt);
    if (userErr || !userData.user) return jsonResponse(req, { error: "Invalid session" }, 401);
    const role = userData.user.app_metadata?.role;
    if (role !== "bishop" && role !== "admin") {
      await audit(supa, "PUSH_SEND_DENIED", { actor_id: userData.user.id, role });
      return jsonResponse(req, { error: "Forbidden" }, 403);
    }
  }

  try {
    const { user_ids, title, body, icon, screen, tag } = await req.json();
    if (!title || !body) return jsonResponse(req, { error: "Missing title or body" }, 400);

    let filter = "";
    if (user_ids === "all") {
      filter = "select=*";
    } else if (Array.isArray(user_ids) && user_ids.length > 0) {
      filter = `select=*&user_id=in.(${user_ids.map((id: string) => `"${id}"`).join(",")})`;
    } else {
      return jsonResponse(req, { error: "user_ids must be 'all' or an array" }, 400);
    }

    const subsRes = await fetch(`${SUPABASE_URL}/rest/v1/rf_push_subscriptions?${filter}`, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    });
    if (!subsRes.ok) {
      await audit(supa, "PUSH_SEND_SUBS_FETCH_FAILED", { status: subsRes.status });
      return jsonResponse(req, { error: "Failed to fetch subscriptions" }, 500);
    }
    const subscriptions = await subsRes.json();
    if (!subscriptions.length) {
      return jsonResponse(req, { sent: 0, message: "No subscriptions found" }, 200);
    }

    const payload = JSON.stringify({
      title, body,
      icon:   icon   ?? "/icons/kg-logo.jpg",
      screen: screen ?? null,
      tag:    tag    ?? "kg-push-" + Date.now(),
      url:    "/",
    });

    let sent = 0, failed = 0;
    const staleIds: string[] = [];
    for (const sub of subscriptions) {
      try {
        const result = await sendWebPush(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        if (result.ok) sent++;
        else if (result.status === 404 || result.status === 410) { staleIds.push(sub.id); failed++; }
        else failed++;
      } catch { failed++; }
    }

    if (staleIds.length > 0) {
      await fetch(
        `${SUPABASE_URL}/rest/v1/rf_push_subscriptions?id=in.(${staleIds.map((id) => `"${id}"`).join(",")})`,
        { method: "DELETE", headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
      );
    }

    await audit(supa, "PUSH_SEND_DONE", { sent, failed, cleaned: staleIds.length });
    return jsonResponse(req, { sent, failed, cleaned: staleIds.length }, 200);
  } catch (err) {
    await audit(supa, "PUSH_SEND_ERROR", { error: err instanceof Error ? err.message : String(err) });
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});

// ============================================================
// WEB PUSH: RFC 8291 + VAPID (RFC 8292) — unchanged from prior version.
// ============================================================

async function sendWebPush(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
): Promise<{ ok: boolean; status: number }> {
  const vapidPrivateBytes = base64UrlDecode(VAPID_PRIVATE_KEY);
  const audience = new URL(subscription.endpoint).origin;
  const jwt = await createVapidJwt(vapidPrivateBytes, audience, VAPID_SUBJECT);
  const encrypted = await encryptPayload(payload, subscription.keys.p256dh, subscription.keys.auth);
  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization:    `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type":     "application/octet-stream",
      TTL:                "86400",
      Urgency:            "normal",
    },
    body: encrypted,
  });
  return { ok: res.ok || res.status === 201, status: res.status };
}

// TypeScript 5.7+ tightened BufferSource to ArrayBufferView<ArrayBuffer>.
// Slicing the underlying buffer gives us a guaranteed ArrayBuffer (not
// SharedArrayBuffer) that satisfies Web Crypto's BufferSource type.
function bs(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

async function createVapidJwt(privateKeyBytes: Uint8Array, audience: string, subject: string): Promise<string> {
  const header = base64UrlEncode(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const now = Math.floor(Date.now() / 1000);
  const claims = base64UrlEncode(JSON.stringify({ aud: audience, exp: now + 86400, sub: subject }));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8", bs(wrapEcPrivateKey(privateKeyBytes)),
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));
  const rawSig = derToRaw(new Uint8Array(sig));
  return `${unsigned}.${base64UrlEncodeBytes(rawSig)}`;
}

async function encryptPayload(payload: string, p256dhBase64: string, authBase64: string): Promise<Uint8Array> {
  const clientPublicBytes = base64UrlDecode(p256dhBase64);
  const authSecret = base64UrlDecode(authBase64);
  const localKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const clientPublicKey = await crypto.subtle.importKey("raw", bs(clientPublicBytes), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: clientPublicKey }, localKeys.privateKey, 256));
  const localPublicBytes = new Uint8Array(await crypto.subtle.exportKey("raw", localKeys.publicKey));
  const ikmInfo = concatBytes(new TextEncoder().encode("WebPush: info\0"), clientPublicBytes, localPublicBytes);
  const ikm = await hkdf(authSecret, sharedSecret, ikmInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cekInfo   = new TextEncoder().encode("Content-Encoding: aes128gcm\0");
  const nonceInfo = new TextEncoder().encode("Content-Encoding: nonce\0");
  const cek   = await hkdf(salt, ikm, cekInfo,   16);
  const nonce = await hkdf(salt, ikm, nonceInfo, 12);
  const paddedPayload = concatBytes(new TextEncoder().encode(payload), new Uint8Array([2]));
  const encKey = await crypto.subtle.importKey("raw", bs(cek), "AES-GCM", false, ["encrypt"]);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: bs(nonce) }, encKey, bs(paddedPayload)));
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concatBytes(salt, rs, new Uint8Array([localPublicBytes.length]), localPublicBytes, encrypted);
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key  = await crypto.subtle.importKey("raw", bs(ikm), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: bs(salt), info: bs(info) }, key, length * 8);
  return new Uint8Array(bits);
}

function base64UrlDecode(str: string): Uint8Array {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const binary = atob(b64 + pad);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
function base64UrlEncode(str: string): string {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64UrlEncodeBytes(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const a of arrays) { result.set(a, offset); offset += a.length; }
  return result;
}
function wrapEcPrivateKey(rawKey: Uint8Array): Uint8Array {
  const prefix = new Uint8Array([
    0x30, 0x81, 0x87, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86,
    0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d,
    0x03, 0x01, 0x07, 0x04, 0x6d, 0x30, 0x6b, 0x02, 0x01, 0x01, 0x04, 0x20,
  ]);
  return concatBytes(prefix, rawKey);
}
function derToRaw(der: Uint8Array): Uint8Array {
  const raw = new Uint8Array(64);
  let offset = 2;
  offset++;
  const rLen = der[offset++];
  const rStart = rLen > 32 ? offset + (rLen - 32) : offset;
  const rDest  = rLen < 32 ? 32 - rLen : 0;
  raw.set(der.slice(rStart, offset + rLen), rDest);
  offset += rLen;
  offset++;
  const sLen = der[offset++];
  const sStart = sLen > 32 ? offset + (sLen - 32) : offset;
  const sDest  = sLen < 32 ? 64 - sLen : 32;
  raw.set(der.slice(sStart, offset + sLen), sDest);
  return raw;
}
