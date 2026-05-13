// ============================================================
// kgfcm-pin-register — Create a new pastor record + auth user.
//
// POST { email, full_name, pin, invite_token? }
// No client JWT required. Server-side flow:
//   1. CORS / shape / rate-limit.
//   2. If invite_token supplied, validate it is unused.
//   3. Refuse if email already in use.
//   4. bcrypt-hash PIN server-side.
//   5. Create auth.users with app_metadata.role='pastor'.
//   6. Insert rf_pastors row with auth_user_id linked.
//   7. Mark invite as accepted (if used).
//   8. Issue Supabase Auth session.
//   9. Audit + constant-time response.
// ============================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };
import { corsHeaders, isOriginAllowed, jsonResponse } from "../_shared/cors.ts";
import { audit } from "../_shared/audit.ts";
import { rateLimit, padTo } from "../_shared/rate_limit.ts";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")              ?? "";
const SERVICE_ROLE_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY              = Deno.env.get("SUPABASE_ANON_KEY")         ?? "";
const MIN_RESPONSE_MS       = 400;
const EMAIL_RE              = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PIN_RE                = /^\d{6}$/;          // pastors must use 6-digit PIN
const NAME_RE               = /^[\p{L}\p{M}\s'.-]{2,80}$/u;

Deno.serve(async (req: Request) => {
  const started = performance.now();

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }
  if (!isOriginAllowed(req)) {
    return jsonResponse(req, { error: "Forbidden origin" }, 403);
  }
  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim();

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const email        = String(body.email ?? "").trim().toLowerCase();
    const full_name    = String(body.full_name ?? "").trim();
    const pin          = String(body.pin ?? "");
    const invite_token = String(body.invite_token ?? "").trim();

    if (!EMAIL_RE.test(email) || !PIN_RE.test(pin) || !NAME_RE.test(full_name)) {
      await audit(supa, "REGISTER_BAD_INPUT", { ip_address: ip });
      await padTo(started, MIN_RESPONSE_MS);
      return jsonResponse(req, { error: "Invalid registration details" }, 400);
    }

    const rl = await rateLimit({ supa, email, ip, kind: "register" });
    if (rl.limited) {
      await audit(supa, "REGISTER_RATE_LIMITED", { ip_address: ip });
      await padTo(started, MIN_RESPONSE_MS);
      return jsonResponse(req, { error: "Too many attempts. Try again later." }, 429);
    }

    // Email already in use?
    const existing = await supa.from("rf_pastors").select("id").eq("email", email).maybeSingle();
    if (existing.data) {
      await audit(supa, "REGISTER_DUPLICATE_EMAIL", { ip_address: ip, target_table: "rf_pastors", target_id: existing.data.id });
      await padTo(started, MIN_RESPONSE_MS);
      return jsonResponse(req, { error: "An account with that email already exists." }, 409);
    }

    // Invite validation
    let inviteId: string | null = null;
    if (invite_token) {
      const inv = await supa.from("rf_invites").select("id,accepted_at").eq("token", invite_token).maybeSingle();
      if (!inv.data || inv.data.accepted_at) {
        await audit(supa, "REGISTER_BAD_INVITE", { ip_address: ip });
        await padTo(started, MIN_RESPONSE_MS);
        return jsonResponse(req, { error: "Invite is invalid or already used." }, 400);
      }
      inviteId = inv.data.id;
    }

    // Hash PIN server-side
    const { data: bcryptHash, error: hashErr } = await supa.rpc("hash_pin", { p_pin: pin });
    if (hashErr || !bcryptHash) throw hashErr ?? new Error("hash_pin returned empty");

    // Create the auth user
    const created = await supa.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: { role: "pastor", provider: "pin" },
    });
    if (created.error || !created.data.user) throw created.error ?? new Error("createUser returned no user");
    const authUserId = created.data.user.id;

    // Insert rf_pastors row
    const ins = await supa.from("rf_pastors").insert({
      email,
      full_name,
      pin_bcrypt: bcryptHash,
      auth_user_id: authUserId,
      role: "pastor",
      status: "active",
      posts_this_week: 0,
    }).select("id").single();
    if (ins.error || !ins.data) {
      // Roll back the auth user if the profile insert failed.
      await supa.auth.admin.deleteUser(authUserId);
      throw ins.error ?? new Error("rf_pastors insert returned no row");
    }
    const pastorId = ins.data.id;

    if (inviteId) {
      await supa.from("rf_invites").update({ accepted_at: new Date().toISOString() }).eq("id", inviteId);
    }

    // Issue session via magic-link OTP, server-side.
    const link = await supa.auth.admin.generateLink({ type: "magiclink", email });
    if (link.error) throw link.error;
    const otp = link.data.properties?.email_otp;
    if (!otp) throw new Error("generateLink returned no email_otp");

    const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const verified = await anonClient.auth.verifyOtp({ email, token: otp, type: "email" });
    if (verified.error || !verified.data.session) throw verified.error ?? new Error("verifyOtp returned no session");

    await audit(supa, "PASTOR_REGISTERED", {
      ip_address: ip,
      actor_id: authUserId,
      actor_role: "pastor",
      target_table: "rf_pastors",
      target_id: pastorId,
    });
    await padTo(started, MIN_RESPONSE_MS);
    return jsonResponse(req, {
      access_token:  verified.data.session.access_token,
      refresh_token: verified.data.session.refresh_token,
      expires_at:    verified.data.session.expires_at ?? 0,
      user_id:       authUserId,
      role:          "pastor",
      profile_id:    pastorId,
    }, 200);
  } catch (err) {
    await audit(supa, "REGISTER_ERROR", {
      ip_address: ip,
      error: err instanceof Error ? err.message : String(err),
    });
    await padTo(started, MIN_RESPONSE_MS);
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});
