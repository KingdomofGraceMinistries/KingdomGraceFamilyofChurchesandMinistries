// VAPID (RFC 8292) signing key for Web Push.
//
// VAPID_PRIVATE_KEY is the raw 32-byte P-256 private scalar and
// VAPID_PUBLIC_KEY the 65-byte uncompressed public point (0x04 || x || y),
// both base64url — the format every VAPID key generator emits. They are
// imported as a JWK {kty, crv, d, x, y}: the standard, unambiguous form.
//
// The previous code wrapped the raw scalar in a hand-built PKCS#8 header
// whose lengths described a structure that also embeds the public key —
// which was never appended — so importKey always failed ("expected valid
// PKCS#8 data") and no push was ever signed.

function b64urlToBytes(str: string): Uint8Array {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return Uint8Array.from(atob(b64 + pad), (c) => c.charCodeAt(0));
}

function bytesToB64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function importVapidSigningKey(privateKeyB64url: string, publicKeyB64url: string): Promise<CryptoKey> {
  const d = b64urlToBytes(privateKeyB64url.trim());
  const pub = b64urlToBytes(publicKeyB64url.trim());
  if (d.length !== 32) throw new Error(`VAPID private key must be 32 bytes, got ${d.length}`);
  if (pub.length !== 65 || pub[0] !== 0x04) throw new Error(`VAPID public key must be a 65-byte uncompressed P-256 point, got ${pub.length} bytes`);
  const x = bytesToB64url(pub.slice(1, 33));
  const y = bytesToB64url(pub.slice(33, 65));
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", d: bytesToB64url(d), x, y, ext: false },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  // importKey does not check that d belongs to (x, y). A mismatched pair
  // signs happily and every push service answers 403, so prove the pair here
  // and fail with a clear error instead.
  const verifier = await crypto.subtle.importKey(
    "jwk", { kty: "EC", crv: "P-256", x, y, ext: false },
    { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"],
  );
  const probe = new TextEncoder().encode("vapid-key-pair-check");
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, probe);
  if (!(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifier, sig, probe))) {
    throw new Error("VAPID private key does not match VAPID_PUBLIC_KEY");
  }
  return key;
}

// The VAPID JWT for one push service origin. Web Crypto's ECDSA sign returns
// the signature as raw r || s (64 bytes, IEEE P1363) — exactly the form
// ES256 in a JWT requires — so it is used as-is. The previous code passed it
// through a DER-to-raw converter, which scrambled every signature, and push
// services answered 403.
export async function signVapidJwt(
  key: CryptoKey, audience: string, subject: string, nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const enc = (o: unknown) => bytesToB64url(new TextEncoder().encode(JSON.stringify(o)));
  // 12 hours: push services reject an exp more than 24 hours ahead, and an
  // exp of exactly 24 hours is pushed over that limit by any clock skew.
  const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({ aud: audience, exp: nowSeconds + 12 * 60 * 60, sub: subject })}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned)));
  if (sig.length !== 64) throw new Error(`unexpected ECDSA signature length ${sig.length}`);
  return `${unsigned}.${bytesToB64url(sig)}`;
}
