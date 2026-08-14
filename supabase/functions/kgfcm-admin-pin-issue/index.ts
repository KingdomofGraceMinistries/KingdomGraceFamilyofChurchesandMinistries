// ============================================================
// kgfcm-admin-pin-issue — Issue a working 6-digit PIN to an
// admin and email it to them directly.
//
// Bishop-only. POST { admin_id }; verify_jwt: true.
//
// Why this exists separately from kgfcm-pin-reset: that flow
// emails an 8-hex reset TOKEN, which the recipient must then
// exchange for a PIN they choose themselves. Two steps, and the
// emailed value is not a credential. This flow emails a PIN that
// works immediately — one step, nothing for the recipient to
// invent, and nothing for the bishop to read out over the phone.
//
// The plaintext PIN exists only inside this function's memory and
// the outbound email. It is never returned to the caller, never
// written to rf_audit_log, and never rendered in the dashboard —
// so no operator, log, or transcript ever holds it. Only the
// bcrypt digest is persisted, via the hash_pin SECURITY DEFINER
// RPC (bf, cost 10) that the reset-confirm flow already uses.
//
// Flow:
//   1. CORS + bishop JWT claim check.
//   2. Rate-limit per target email + per IP.
//   3. Resolve the rf_admins row. Refuse the bishop's own row —
//      his credential lives in rf_network_config, so writing
//      pin_bcrypt here would not change his login and would leave
//      a misleading digest behind.
//   4. CSPRNG 6-digit PIN, rejection-sampled to avoid modulo bias.
//   5. bcrypt via hash_pin, write pin_bcrypt, clear any
//      outstanding reset token so an old code cannot race it.
//   6. Email the PIN. Audit delivery metadata only.
// ============================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.50.5";
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };
import { corsHeaders, isOriginAllowed, jsonResponse } from "../_shared/cors.ts";
import { audit } from "../_shared/audit.ts";
import { rateLimit, padTo } from "../_shared/rate_limit.ts";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")              ?? "";
// JWT-format service role first: supabase-js 2.50.5 hands sb_secret_* through to PostgREST as-is and PostgREST rejects non-JWT bearers with 401.
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SECRET_KEY") ?? "";
const RESEND_API_KEY   = Deno.env.get("RESEND_API_KEY")            ?? "";
const RESEND_FROM      = Deno.env.get("RESEND_FROM")               ?? "Kingdom Grace <noreply@kingdomgracefamily.com>";
const NETWORK_SHORT    = Deno.env.get("NETWORK_SHORT")             ?? "Kingdom Grace";
const MIN_RESPONSE_MS  = 600;

Deno.serve(async (req: Request) => {
  const started = performance.now();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (!isOriginAllowed(req))    return jsonResponse(req, { error: "Forbidden origin" }, 403);
  if (req.method !== "POST")    return jsonResponse(req, { error: "Method not allowed" }, 405);

  const supa: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim();

  // The Functions Gateway already verified the signature (verify_jwt:true),
  // so claims can be read directly — same pattern as kgfcm-devotion-generate.
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return jsonResponse(req, { error: "Missing JWT" }, 401);
  const claims = decodeJwtClaims(jwt);
  if (!claims) return jsonResponse(req, { error: "Invalid JWT" }, 401);
  const appMeta = (claims.app_metadata ?? {}) as Record<string, unknown>;
  const actorId = typeof claims.sub === "string" ? claims.sub : "unknown";
  // Bishop only, deliberately stricter than is_bishop() (which also admits
  // admins). Issuing another user's credential is not a delegated power.
  if (appMeta.role !== "bishop") {
    await audit(supa, "ADMIN_PIN_ISSUE_DENIED", { actor_id: actorId, ip_address: ip, role: typeof appMeta.role === "string" ? appMeta.role : "" });
    return jsonResponse(req, { error: "Forbidden" }, 403);
  }

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const adminId = String(body.admin_id ?? "").trim();
    if (!adminId) {
      await padTo(started, MIN_RESPONSE_MS);
      return jsonResponse(req, { error: "admin_id is required" }, 400);
    }

    const target = await supa.from("rf_admins")
      .select("id,full_name,email,status,is_bishop")
      .eq("id", adminId)
      .maybeSingle();
    if (target.error || !target.data) {
      await audit(supa, "ADMIN_PIN_ISSUE_NOT_FOUND", { actor_id: actorId, ip_address: ip, target_table: "rf_admins", target_id: adminId });
      await padTo(started, MIN_RESPONSE_MS);
      return jsonResponse(req, { error: "Admin not found" }, 404);
    }
    const admin = target.data;
    if (!admin.email) {
      await padTo(started, MIN_RESPONSE_MS);
      return jsonResponse(req, { error: "That admin has no email address on file." }, 400);
    }
    if (admin.is_bishop) {
      await audit(supa, "ADMIN_PIN_ISSUE_REFUSED_BISHOP", { actor_id: actorId, ip_address: ip, target_table: "rf_admins", target_id: admin.id });
      await padTo(started, MIN_RESPONSE_MS);
      return jsonResponse(req, { error: "The bishop's own PIN is not managed here." }, 400);
    }

    const rl = await rateLimit({ supa, email: String(admin.email).toLowerCase(), ip, kind: "reset" });
    if (rl.limited) {
      await audit(supa, "ADMIN_PIN_ISSUE_RATE_LIMITED", { actor_id: actorId, ip_address: ip, target_table: "rf_admins", target_id: admin.id });
      await padTo(started, MIN_RESPONSE_MS);
      return jsonResponse(req, { error: "Too many attempts for this admin. Try again later." }, 429);
    }

    const pin = generateSixDigitPin();
    const { data: bcryptHash, error: hashErr } = await supa.rpc("hash_pin", { p_pin: pin });
    if (hashErr || !bcryptHash) {
      await audit(supa, "ADMIN_PIN_ISSUE_HASH_FAILED", { actor_id: actorId, ip_address: ip, target_id: admin.id, error: String(hashErr) });
      await padTo(started, MIN_RESPONSE_MS);
      return jsonResponse(req, { error: "Could not set the PIN." }, 500);
    }

    // Clearing the reset token stops an already-emailed reset code from being
    // redeemed after this PIN is issued, which would silently override it.
    const upd = await supa.from("rf_admins")
      .update({ pin_bcrypt: bcryptHash, pin_hash: "migrated-to-bcrypt", reset_token_hash: null, reset_token_expires: null, status: "active" })
      .eq("id", admin.id);
    if (upd.error) {
      await audit(supa, "ADMIN_PIN_ISSUE_DB_WRITE_FAILED", { actor_id: actorId, ip_address: ip, target_id: admin.id, error: String(upd.error) });
      await padTo(started, MIN_RESPONSE_MS);
      return jsonResponse(req, { error: "Could not set the PIN." }, 500);
    }

    const emailRes = await sendPinEmail(String(admin.email), String(admin.full_name ?? ""), pin);
    // Delivery metadata only. The PIN itself is deliberately absent.
    await audit(supa, "ADMIN_PIN_ISSUED", {
      actor_id:     actorId,
      ip_address:   ip,
      target_table: "rf_admins",
      target_id:    admin.id,
      delivered:    emailRes.ok,
      send_status:  emailRes.status,
      resend_id:    emailRes.id,
      send_error:   emailRes.error,
    });

    await padTo(started, MIN_RESPONSE_MS);
    if (!emailRes.ok) {
      // The PIN is already live on the row but the email did not go out, and
      // nothing else holds the plaintext. Say so plainly rather than implying
      // the admin can sign in — the bishop must re-issue.
      return jsonResponse(req, { sent: false, error: "PIN was set but the email could not be delivered. Send it again." }, 502);
    }
    return jsonResponse(req, { sent: true, email: admin.email }, 200);
  } catch (err) {
    await audit(supa, "ADMIN_PIN_ISSUE_FN_ERROR", { actor_id: actorId, ip_address: ip, error: err instanceof Error ? err.message : String(err) });
    await padTo(started, MIN_RESPONSE_MS);
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});

function decodeJwtClaims(jwt: string): Record<string, unknown> | null {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// CSPRNG 6-digit PIN. Rejection sampling: values at or above the largest
// multiple of 1e6 that fits in a uint32 are discarded, so every one of the
// million codes is equally likely. A plain % 1000000 would bias the low
// ~3,000 codes upward, which is exactly the range an attacker guesses first.
function generateSixDigitPin(): string {
  const RANGE = 1_000_000;
  const limit = Math.floor(0xFFFFFFFF / RANGE) * RANGE;
  const buf = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return String(value % RANGE).padStart(6, "0");
}

async function sendPinEmail(to: string, name: string, pin: string): Promise<{ ok: boolean; status: number; id?: string; error?: string }> {
  if (!RESEND_API_KEY) return { ok: false, status: 0, error: "RESEND_API_KEY not set" };
  const greeting = name ? `Hello ${name},` : `Hello,`;
  const subject = `Your ${NETWORK_SHORT} admin access`;
  const text = [
    greeting,
    ``,
    `You have been given admin access to the ${NETWORK_SHORT} app.`,
    ``,
    `Your 6-digit PIN is:`,
    ``,
    `    ${pin}`,
    ``,
    `To sign in: open the app, tap "Admin Access", and enter this email address along with the PIN above.`,
    ``,
    `Keep this PIN private. You can change it at any time from the sign-in screen by tapping "Locked out? Reset your PIN".`,
    ``,
    `— ${NETWORK_SHORT}`,
  ].join("\n");
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.5;padding:24px;max-width:480px;margin:0 auto">
    <h2 style="font-family:Georgia,serif;color:#8a6a1c;margin:0 0 16px">${NETWORK_SHORT}</h2>
    <p>${escapeHtml(greeting)}</p>
    <p>You have been given <strong>admin access</strong> to the ${NETWORK_SHORT} app.</p>
    <p>Your 6-digit PIN is:</p>
    <p style="font-size:28px;font-weight:600;letter-spacing:6px;background:#f5f1e6;padding:14px 20px;border-radius:8px;text-align:center;margin:20px 0">${pin}</p>
    <p>To sign in: open the app, tap <strong>"Admin Access"</strong>, and enter this email address along with the PIN above.</p>
    <p style="color:#666;font-size:14px">Keep this PIN private. You can change it at any time from the sign-in screen by tapping "Locked out? Reset your PIN".</p>
    <p style="color:#888;font-size:12px;margin-top:32px">— ${NETWORK_SHORT}</p>
  </body></html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: RESEND_FROM, to, subject, text, html }),
  });
  let id: string | undefined;
  let error: string | undefined;
  try {
    const j = await res.json();
    id = j?.id;
    if (!res.ok) error = j?.message ?? j?.name ?? JSON.stringify(j).slice(0, 240);
  } catch (_) { /* non-JSON response */ }
  return { ok: res.ok, status: res.status, id, error };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
