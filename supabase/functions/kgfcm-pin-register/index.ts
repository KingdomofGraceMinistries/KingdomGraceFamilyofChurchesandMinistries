// ============================================================
// kgfcm-pin-register — Create a new pastor record + auth user.
//
// POST { email, full_name, pin, invite_token }
// No client JWT required — the invite token IS the authorisation, so it is
// mandatory. Before 2026-11-18 it was optional here (only the client
// insisted), so anyone calling this endpoint directly could make themselves
// an active pastor. Server-side flow:
//   1. CORS / shape (invite_token required) / rate-limit.
//   2. Refuse if the email belongs to a pastor or an admin.
//   3. Claim the invite atomically: one UPDATE ... WHERE accepted_at IS NULL.
//      Two sign-ups racing one link cannot both win.
//   4. bcrypt-hash PIN server-side.
//   5. Create auth.users with app_metadata.role='pastor'.
//   6. Insert rf_pastors row with auth_user_id linked.
//   7. Issue Supabase Auth session.
//   8. Audit + constant-time response.
// Any failure after step 3 releases the claim so the invitee can retry.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };
import { corsHeaders, isOriginAllowed, jsonResponse } from "../_shared/cors.ts";
import { audit } from "../_shared/audit.ts";
import { PUBLISHABLE_KEY, SECRET_KEY } from "../_shared/server_key.ts";
import { rateLimit, padTo } from "../_shared/rate_limit.ts";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")              ?? "";
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

  const supa = createClient(SUPABASE_URL, SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim();

  // Set once the invite is claimed; released in the catch if a later step fails.
  let claimedInviteId: string | null = null;

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const email        = String(body.email ?? "").trim().toLowerCase();
    const full_name    = String(body.full_name ?? "").trim();
    const pin          = String(body.pin ?? "");
    const invite_token = String(body.invite_token ?? "").trim();

    if (!invite_token) {
      await audit(supa, "REGISTER_NO_INVITE", { ip_address: ip });
      await padTo(started, MIN_RESPONSE_MS);
      return jsonResponse(req, { error: "An invite link is required to join. Ask your Bishop for one." }, 400);
    }
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

    // An admin's email must not become a pastor: login checks rf_admins
    // first, so the pastor account would be permanently shadowed. Same guard
    // as create_pastor().
    // ilike for case-insensitivity (admin emails are stored as typed), with
    // its wildcards escaped so "a_b@x.com" cannot match "axb@x.com".
    const adminHit = await supa.from("rf_admins").select("id")
      .ilike("email", email.replace(/[\\%_]/g, (c) => "\\" + c))
      .limit(1).maybeSingle();
    if (adminHit.data) {
      await audit(supa, "REGISTER_DUPLICATE_EMAIL", { ip_address: ip, target_table: "rf_admins", target_id: adminHit.data.id });
      await padTo(started, MIN_RESPONSE_MS);
      return jsonResponse(req, { error: "An account with that email already exists." }, 409);
    }

    // Claim the invite in one statement. Only an existing, unused invite
    // matches, and only one concurrent caller can flip accepted_at.
    const claim = await supa.from("rf_invites")
      .update({ accepted_at: new Date().toISOString() })
      .eq("token", invite_token)
      .is("accepted_at", null)
      .select("id")
      .maybeSingle();
    if (claim.error) throw claim.error;
    if (!claim.data) {
      await audit(supa, "REGISTER_BAD_INVITE", { ip_address: ip });
      await padTo(started, MIN_RESPONSE_MS);
      return jsonResponse(req, { error: "This invite link is invalid or has already been used. Ask your Bishop for a new one." }, 400);
    }
    claimedInviteId = claim.data.id;

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
    // The pastor now exists, so the invite stays spent even if issuing the
    // session below fails — they sign in with their PIN instead.
    claimedInviteId = null;

    // Issue session via magic-link OTP, server-side.
    const link = await supa.auth.admin.generateLink({ type: "magiclink", email });
    if (link.error) throw link.error;
    const otp = link.data.properties?.email_otp;
    if (!otp) throw new Error("generateLink returned no email_otp");

    const publicClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const verified = await publicClient.auth.verifyOtp({ email, token: otp, type: "email" });
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
    if (claimedInviteId) {
      const release = await supa.from("rf_invites").update({ accepted_at: null }).eq("id", claimedInviteId);
      if (release.error) {
        await audit(supa, "REGISTER_INVITE_RELEASE_FAILED", { ip_address: ip, target_table: "rf_invites", target_id: claimedInviteId, error: release.error.message });
      }
    }
    await audit(supa, "REGISTER_ERROR", {
      ip_address: ip,
      error: err instanceof Error ? err.message : String(err),
    });
    await padTo(started, MIN_RESPONSE_MS);
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});
