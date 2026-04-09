// ============================================================
// kgfcm-push-send — Web Push sender for Kingdom Grace
// Supabase Edge Function (Deno runtime)
//
// Accepts a payload + list of user_ids (or "all"),
// looks up their push subscriptions, and sends web push
// notifications to each device.
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// VAPID keys — private key stored as Supabase secret
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:kgfcm2023@gmail.com";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { user_ids, title, body, icon, screen, tag } = await req.json();

    if (!title || !body) {
      return new Response(JSON.stringify({ error: "Missing title or body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch subscriptions from Supabase
    let filter = "";
    if (user_ids === "all") {
      filter = "select=*";
    } else if (Array.isArray(user_ids) && user_ids.length > 0) {
      filter = `select=*&user_id=in.(${user_ids.map((id: string) => `"${id}"`).join(",")})`;
    } else {
      return new Response(JSON.stringify({ error: "user_ids must be 'all' or an array" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const subsRes = await fetch(`${SUPABASE_URL}/rest/v1/rf_push_subscriptions?${filter}`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    if (!subsRes.ok) {
      return new Response(JSON.stringify({ error: "Failed to fetch subscriptions" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const subscriptions = await subsRes.json();

    if (!subscriptions.length) {
      return new Response(JSON.stringify({ sent: 0, message: "No subscriptions found" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build push payload
    const payload = JSON.stringify({
      title,
      body,
      icon: icon || "/icons/kg-logo.jpg",
      screen: screen || null,
      tag: tag || "kg-push-" + Date.now(),
      url: "/",
    });

    // Send to each subscription
    let sent = 0;
    let failed = 0;
    const staleIds: string[] = [];

    for (const sub of subscriptions) {
      try {
        const pushSub = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        };

        const result = await sendWebPush(pushSub, payload);

        if (result.ok) {
          sent++;
        } else if (result.status === 404 || result.status === 410) {
          // Subscription expired or unsubscribed — mark for cleanup
          staleIds.push(sub.id);
          failed++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    // Clean up stale subscriptions
    if (staleIds.length > 0) {
      await fetch(
        `${SUPABASE_URL}/rest/v1/rf_push_subscriptions?id=in.(${staleIds.map((id) => `"${id}"`).join(",")})`,
        {
          method: "DELETE",
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      );
    }

    return new Response(JSON.stringify({ sent, failed, cleaned: staleIds.length }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Push send error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ============================================================
// WEB PUSH: RFC 8291 + VAPID (RFC 8292) implementation
// Uses Web Crypto API available in Deno
// ============================================================

async function sendWebPush(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string
): Promise<{ ok: boolean; status: number }> {
  // Import VAPID private key
  const vapidPrivateBytes = base64UrlDecode(VAPID_PRIVATE_KEY);

  // Create JWT for VAPID
  const audience = new URL(subscription.endpoint).origin;
  const jwt = await createVapidJwt(vapidPrivateBytes, audience, VAPID_SUBJECT);

  // Encrypt the payload using the subscription keys
  const encrypted = await encryptPayload(
    payload,
    subscription.keys.p256dh,
    subscription.keys.auth
  );

  // Send the push message
  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "normal",
    },
    body: encrypted,
  });

  return { ok: res.ok || res.status === 201, status: res.status };
}

// ── VAPID JWT ──
async function createVapidJwt(
  privateKeyBytes: Uint8Array,
  audience: string,
  subject: string
): Promise<string> {
  const header = base64UrlEncode(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const now = Math.floor(Date.now() / 1000);
  const claims = base64UrlEncode(
    JSON.stringify({ aud: audience, exp: now + 86400, sub: subject })
  );
  const unsigned = `${header}.${claims}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    wrapEcPrivateKey(privateKeyBytes),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(unsigned)
  );

  // Convert DER signature to raw r||s (64 bytes)
  const rawSig = derToRaw(new Uint8Array(sig));
  return `${unsigned}.${base64UrlEncodeBytes(rawSig)}`;
}

// ── PAYLOAD ENCRYPTION (RFC 8291 aes128gcm) ──
async function encryptPayload(
  payload: string,
  p256dhBase64: string,
  authBase64: string
): Promise<Uint8Array> {
  const clientPublicBytes = base64UrlDecode(p256dhBase64);
  const authSecret = base64UrlDecode(authBase64);

  // Generate ephemeral ECDH key pair
  const localKeys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );

  // Import client public key
  const clientPublicKey = await crypto.subtle.importKey(
    "raw",
    clientPublicBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // ECDH shared secret
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: clientPublicKey },
      localKeys.privateKey,
      256
    )
  );

  // Export local public key (uncompressed)
  const localPublicBytes = new Uint8Array(
    await crypto.subtle.exportKey("raw", localKeys.publicKey)
  );

  // HKDF to derive IKM
  const ikmInfo = concatBytes(
    new TextEncoder().encode("WebPush: info\0"),
    clientPublicBytes,
    localPublicBytes
  );
  const ikm = await hkdf(authSecret, sharedSecret, ikmInfo, 32);

  // Salt (random 16 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Derive content encryption key and nonce
  const cekInfo = new TextEncoder().encode("Content-Encoding: aes128gcm\0");
  const nonceInfo = new TextEncoder().encode("Content-Encoding: nonce\0");
  const cek = await hkdf(salt, ikm, cekInfo, 16);
  const nonce = await hkdf(salt, ikm, nonceInfo, 12);

  // Pad and encrypt payload
  const paddedPayload = concatBytes(
    new TextEncoder().encode(payload),
    new Uint8Array([2]) // delimiter
  );

  const encKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, [
    "encrypt",
  ]);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      encKey,
      paddedPayload
    )
  );

  // Build aes128gcm header: salt(16) + rs(4) + idlen(1) + keyid(65) + ciphertext
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);

  return concatBytes(
    salt,
    rs,
    new Uint8Array([localPublicBytes.length]),
    localPublicBytes,
    encrypted
  );
}

// ── HKDF (extract + expand) ──
async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    length * 8
  );
  return new Uint8Array(bits);
}

// ── HELPERS ──
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
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

// Wrap raw 32-byte EC private key in PKCS#8 DER for Web Crypto import
function wrapEcPrivateKey(rawKey: Uint8Array): Uint8Array {
  // PKCS#8 prefix for P-256 EC private key
  const prefix = new Uint8Array([
    0x30, 0x81, 0x87, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86,
    0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d,
    0x03, 0x01, 0x07, 0x04, 0x6d, 0x30, 0x6b, 0x02, 0x01, 0x01, 0x04, 0x20,
  ]);
  const suffix = new Uint8Array([
    0xa1, 0x44, 0x03, 0x42, 0x00,
  ]);
  // We need the public key too — but we can derive it, or use a simpler approach
  // For PKCS8 without public key:
  const inner = concatBytes(prefix, rawKey);
  return inner;
}

// Convert DER ECDSA signature to raw 64-byte r||s format
function derToRaw(der: Uint8Array): Uint8Array {
  // DER: 0x30 <len> 0x02 <rlen> <r> 0x02 <slen> <s>
  const raw = new Uint8Array(64);
  let offset = 2; // skip 0x30 and total length

  // R
  offset++; // skip 0x02
  const rLen = der[offset++];
  const rStart = rLen > 32 ? offset + (rLen - 32) : offset;
  const rDest = rLen < 32 ? 32 - rLen : 0;
  raw.set(der.slice(rStart, offset + rLen), rDest);
  offset += rLen;

  // S
  offset++; // skip 0x02
  const sLen = der[offset++];
  const sStart = sLen > 32 ? offset + (sLen - 32) : offset;
  const sDest = sLen < 32 ? 64 - sLen : 32;
  raw.set(der.slice(sStart, offset + sLen), sDest);

  return raw;
}
