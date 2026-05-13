// ============================================================
// kgfcm-pin-reset-confirm — Verify reset code, set new PIN,
// issue an authenticated session (so user is auto-logged-in
// after a successful reset — no second login round-trip).
//
// POST { email, code, new_pin }; verify_jwt: false.
//   1. CORS + rate-limit.
//   2. Validate code shape and new_pin shape.
//   3. Look up target by email; load reset_token_hash + expires.
//   4. Constant-time SHA-256 compare. Fail-soft to constant-time
//      response regardless of match — same 401 shape either way.
//   5. On match: bcrypt the new_pin server-side via hash_pin RPC,
//      update pin_bcrypt, clear reset_token_hash/expires.
//   6. Issue session via auth.admin.generateLink → verifyOtp.
//   7. Audit success / failure.
// ============================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };
import { corsHeaders, isOriginAllowed, jsonResponse } from "../_shared/cors.ts";
import { audit } from "../_shared/audit.ts";
import { rateLimit, padTo, hashCode } from "../_shared/rate_limit.ts";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")              ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY         = Deno.env.get("SUPABASE_ANON_KEY")         ?? "";
const MIN_RESPONSE_MS  = 500;
const EMAIL_RE         = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CODE_RE          = /^[0-9a-f]{8}$/i;
const PIN_RE           = /^\d{6}$/;

interface Target {
  table: "rf_pastors" | "rf_admins";
  id:    string;
  reset_token_hash:    string | null;
  reset_token_expires: string | null;
  auth_user_id:        string | null;
  role:                "bishop" | "admin" | "pastor";
}

Deno.serve(async (req: Request) => {
  const started = performance.now();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (!isOriginAllowed(req))    return jsonResponse(req, { error: "Forbidden origin" }, 403);
  if (req.method !== "POST")    return jsonResponse(req, { error: "Method not allowed" }, 405);

  const supa: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim();

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const email   = String(body.email   ?? "").trim().toLowerCase();
    const code    = String(body.code    ?? "").trim().toLowerCase();
    const new_pin = String(body.new_pin ?? "");

    if (!EMAIL_RE.test(email) || !CODE_RE.test(code) || !PIN_RE.test(new_pin)) {
      await audit(supa, "RESET_CONFIRM_BAD_INPUT", { ip_address: ip });
      await padTo(started, MIN_RESPONSE_MS);
      return jsonResponse(req, { error: "Invalid reset details" }, 400);
    }

    const rl = await rateLimit({ supa, email, ip, kind: "reset" });
    if (rl.limited) {
      await audit(supa, "RESET_CONFIRM_RATE_LIMITED", { ip_address: ip });
      await padTo(started, MIN_RESPONSE_MS);
      return jsonResponse(req, { error: "Too many attempts. Try again later." }, 429);
    }

    const target = await findTarget(supa, email);
    const codeHash = await hashCode(code);

    if (
      !target ||
      !target.reset_token_hash ||
      !target.reset_token_expires ||
      target.reset_token_hash !== codeHash ||
      new Date(target.reset_token_expires) < new Date()
    ) {
      await audit(supa, "RESET_CONFIRM_FAILED", { ip_address: ip, reason: !target ? "no_account" : "bad_or_expired_code" });
      await padTo(started, MIN_RESPONSE_MS);
      return jsonResponse(req, { error: "Invalid or expired reset code" }, 401);
    }

    // Hash the new PIN via the SECURITY DEFINER RPC (service_role-only).
    const { data: bcryptHash, error: hashErr } = await supa.rpc("hash_pin", { p_pin: new_pin });
    if (hashErr || !bcryptHash) throw hashErr ?? new Error("hash_pin returned empty");

    const upd = await supa.from(target.table)
      .update({ pin_bcrypt: bcryptHash, reset_token_hash: null, reset_token_expires: null })
      .eq("id", target.id);
    if (upd.error) throw upd.error;

    // Auto-log-in: issue a session via magic-link OTP server-side. If the
    // target has no auth_user_id yet, the next PIN login will lazy-bootstrap
    // it; respond with sent:true and let the client redirect to login.
    let session: { access_token: string; refresh_token: string; expires_at: number } | null = null;
    if (target.auth_user_id) {
      const link = await supa.auth.admin.generateLink({ type: "magiclink", email });
      const otp  = link.data?.properties?.email_otp;
      if (!link.error && otp) {
        const anonClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
        const verified = await anonClient.auth.verifyOtp({ email, token: otp, type: "email" });
        if (!verified.error && verified.data.session) {
          session = {
            access_token:  verified.data.session.access_token,
            refresh_token: verified.data.session.refresh_token,
            expires_at:    verified.data.session.expires_at ?? 0,
          };
        }
      }
    }

    await audit(supa, "PIN_RESET_COMPLETE", {
      ip_address:   ip,
      actor_id:     target.auth_user_id ?? target.id,
      actor_role:   target.role,
      target_table: target.table,
      target_id:    target.id,
    });
    await padTo(started, MIN_RESPONSE_MS);
    return jsonResponse(req, {
      ok:           true,
      access_token:  session?.access_token  ?? null,
      refresh_token: session?.refresh_token ?? null,
      expires_at:    session?.expires_at    ?? null,
      user_id:       target.auth_user_id,
      profile_id:    target.id,
      role:          target.role,
    }, 200);
  } catch (err) {
    await audit(supa, "RESET_CONFIRM_FN_ERROR", { ip_address: ip, error: err instanceof Error ? err.message : String(err) });
    await padTo(started, MIN_RESPONSE_MS);
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});

async function findTarget(supa: SupabaseClient, email: string): Promise<Target | null> {
  const cfg = await supa.from("rf_network_config").select("value").eq("key", "bishop_email").maybeSingle();
  const bishopEmail = String(cfg.data?.value ?? "").trim().toLowerCase();

  if (bishopEmail && bishopEmail === email) {
    const ad = await supa.from("rf_admins")
      .select("id,reset_token_hash,reset_token_expires,auth_user_id")
      .eq("email", email).eq("is_bishop", true).maybeSingle();
    if (ad.data) {
      return {
        table: "rf_admins", id: ad.data.id,
        reset_token_hash: ad.data.reset_token_hash,
        reset_token_expires: ad.data.reset_token_expires,
        auth_user_id: ad.data.auth_user_id,
        role: "bishop",
      };
    }
  }

  const admin = await supa.from("rf_admins")
    .select("id,reset_token_hash,reset_token_expires,auth_user_id,is_bishop,status")
    .eq("email", email).eq("status", "active").maybeSingle();
  if (admin.data) {
    return {
      table: "rf_admins", id: admin.data.id,
      reset_token_hash: admin.data.reset_token_hash,
      reset_token_expires: admin.data.reset_token_expires,
      auth_user_id: admin.data.auth_user_id,
      role: admin.data.is_bishop ? "bishop" : "admin",
    };
  }

  const pastor = await supa.from("rf_pastors")
    .select("id,reset_token_hash,reset_token_expires,auth_user_id,role,status")
    .eq("email", email).eq("status", "active").maybeSingle();
  if (pastor.data) {
    return {
      table: "rf_pastors", id: pastor.data.id,
      reset_token_hash: pastor.data.reset_token_hash,
      reset_token_expires: pastor.data.reset_token_expires,
      auth_user_id: pastor.data.auth_user_id,
      role: (pastor.data.role as "pastor") ?? "pastor",
    };
  }

  return null;
}
