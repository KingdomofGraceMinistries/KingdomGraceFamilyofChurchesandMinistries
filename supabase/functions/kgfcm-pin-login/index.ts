// ============================================================
// kgfcm-pin-login — Verify PIN, issue Supabase Auth session.
//
// Endpoint expects POST { email, pin }. No client JWT required
// (callers have no session yet). Server-side flow:
//   1. CORS / shape / rate-limit checks (constant-time padded).
//   2. Decide role (bishop / admin / pastor) by lookup.
//   3. Verify PIN via pgcrypto.crypt() in a SECURITY DEFINER fn.
//   4. Lazy-bootstrap auth.users row if missing.
//   5. Issue a real Supabase Auth session via admin.generateLink
//      → verifyOtp.
//   6. Audit success/failure to rf_audit_log via service_role.
//   7. Constant-time response ≥400ms.
// ============================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.50.5";
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };
import { corsHeaders, isOriginAllowed, jsonResponse } from "../_shared/cors.ts";
import { audit } from "../_shared/audit.ts";
import { rateLimit, padTo } from "../_shared/rate_limit.ts";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")              ?? "";
// JWT-format keys first: supabase-js 2.50.5 hands sb_secret_*/sb_publishable_* through to PostgREST as-is and PostgREST rejects non-JWT bearers with 401.
const SERVICE_ROLE_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SECRET_KEY") ?? "";
const ANON_KEY              = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SB_PUBLISHABLE_KEY") ?? "";
const MIN_RESPONSE_MS       = 400;
const EMAIL_RE              = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PIN_RE                = /^\d{4,8}$/;

type Role = "bishop" | "admin" | "pastor";

interface LoginRow {
  table: "rf_pastors" | "rf_admins" | "config";
  user_id: string | null;       // rf_pastors.id or rf_admins.id, null for bishop-config
  email: string;
  pin_bcrypt: string;
  role: Role;
  auth_user_id: string | null;
}

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
    const email = String(body.email ?? "").trim().toLowerCase();
    const pin   = String(body.pin   ?? "");

    if (!EMAIL_RE.test(email) || !PIN_RE.test(pin)) {
      await audit(supa, "LOGIN_BAD_INPUT", { ip_address: ip });
      await padTo(started, MIN_RESPONSE_MS);
      return jsonResponse(req, { error: "Invalid credentials" }, 400);
    }

    const rl = await rateLimit({ supa, email, ip, kind: "login" });
    if (rl.limited) {
      await audit(supa, "LOGIN_RATE_LIMITED", { ip_address: ip, metadata_email_hash: rl.emailHash });
      await padTo(started, MIN_RESPONSE_MS);
      return jsonResponse(req, { error: "Too many attempts. Try again later." }, 429);
    }

    const candidate = await findLoginCandidate(supa, email);
    if (!candidate) {
      await audit(supa, "LOGIN_FAILED", { ip_address: ip, reason: "no_account" });
      await padTo(started, MIN_RESPONSE_MS);
      return jsonResponse(req, { error: "Invalid credentials" }, 401);
    }

    const valid = await verifyPin(supa, pin, candidate.pin_bcrypt);
    if (!valid) {
      await audit(supa, "LOGIN_FAILED", {
        ip_address: ip, reason: "bad_pin", target_table: candidate.table, target_id: candidate.user_id ?? "bishop",
      });
      await padTo(started, MIN_RESPONSE_MS);
      return jsonResponse(req, { error: "Invalid credentials" }, 401);
    }

    const authUserId = await ensureAuthUser(supa, email, candidate);
    const session    = await issueSession(supa, email);

    await audit(supa, "LOGIN_SUCCESS", {
      ip_address: ip,
      actor_id: authUserId,
      actor_role: candidate.role,
      target_table: candidate.table,
      target_id: candidate.user_id ?? "bishop",
    });
    await padTo(started, MIN_RESPONSE_MS);
    return jsonResponse(req, {
      access_token:  session.access_token,
      refresh_token: session.refresh_token,
      expires_at:    session.expires_at,
      user_id:       authUserId,
      role:          candidate.role,
      profile_id:    candidate.user_id,
    }, 200);
  } catch (err) {
    await audit(supa, "LOGIN_ERROR", {
      ip_address: ip,
      error: err instanceof Error ? err.message : String(err),
    });
    await padTo(started, MIN_RESPONSE_MS);
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});

// ── helpers ────────────────────────────────────────────────

async function findLoginCandidate(
  supa: SupabaseClient,
  email: string,
): Promise<LoginRow | null> {
  // Bishop: identified by rf_network_config.bishop_email match.
  const cfg = await supa
    .from("rf_network_config")
    .select("key,value")
    .in("key", ["bishop_email", "bishop_pin_bcrypt"]);
  const cfgMap = Object.fromEntries((cfg.data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  const bishopEmail   = (cfgMap.bishop_email ?? "").trim().toLowerCase();
  const bishopBcrypt  = cfgMap.bishop_pin_bcrypt ?? "";
  if (bishopEmail && bishopBcrypt && bishopEmail === email) {
    // Check if a corresponding rf_admins row already exists for the bishop
    // (created on first login). Use its auth_user_id if present.
    const ad = await supa
      .from("rf_admins")
      .select("id,auth_user_id")
      .eq("email", email)
      .eq("is_bishop", true)
      .maybeSingle();
    return {
      table: "config",
      user_id: ad.data?.id ?? null,
      email,
      pin_bcrypt: bishopBcrypt,
      role: "bishop",
      auth_user_id: ad.data?.auth_user_id ?? null,
    };
  }

  // Admin
  const admin = await supa
    .from("rf_admins")
    .select("id,email,pin_bcrypt,auth_user_id,is_bishop,status")
    .eq("email", email)
    .eq("status", "active")
    .maybeSingle();
  if (admin.data && admin.data.pin_bcrypt) {
    return {
      table: "rf_admins",
      user_id: admin.data.id,
      email,
      pin_bcrypt: admin.data.pin_bcrypt,
      role: admin.data.is_bishop ? "bishop" : "admin",
      auth_user_id: admin.data.auth_user_id,
    };
  }

  // Pastor
  const pastor = await supa
    .from("rf_pastors")
    .select("id,email,pin_bcrypt,auth_user_id,status,role")
    .eq("email", email)
    .eq("status", "active")
    .maybeSingle();
  if (pastor.data && pastor.data.pin_bcrypt) {
    return {
      table: "rf_pastors",
      user_id: pastor.data.id,
      email,
      pin_bcrypt: pastor.data.pin_bcrypt,
      role: (pastor.data.role as Role) ?? "pastor",
      auth_user_id: pastor.data.auth_user_id,
    };
  }

  return null;
}

async function verifyPin(
  supa: SupabaseClient,
  pin: string,
  hash: string,
): Promise<boolean> {
  const { data, error } = await supa.rpc("verify_pin", { p_pin: pin, p_hash: hash });
  if (error) throw error;
  return data === true;
}

async function ensureAuthUser(
  supa: SupabaseClient,
  email: string,
  candidate: LoginRow,
): Promise<string> {
  if (candidate.auth_user_id) {
    // Make sure the JWT's app_metadata.role is up to date.
    await supa.auth.admin.updateUserById(candidate.auth_user_id, {
      app_metadata: { role: candidate.role, provider: "pin" },
    });
    return candidate.auth_user_id;
  }
  // Lazy bootstrap. Look up by email first (in case another path already created it).
  const list = await supa.auth.admin.listUsers();
  if (list.error) throw list.error;
  const existing = list.data.users.find((u) => (u.email ?? "").toLowerCase() === email);
  let userId: string;
  if (existing) {
    userId = existing.id;
    await supa.auth.admin.updateUserById(userId, {
      app_metadata: { role: candidate.role, provider: "pin" },
    });
  } else {
    const created = await supa.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: { role: candidate.role, provider: "pin" },
    });
    if (created.error) throw created.error;
    userId = created.data.user.id;
  }
  // Link the auth user back to the profile row.
  if (candidate.table === "rf_pastors" && candidate.user_id) {
    await supa.from("rf_pastors").update({ auth_user_id: userId }).eq("id", candidate.user_id);
  } else if (candidate.table === "rf_admins" && candidate.user_id) {
    await supa.from("rf_admins").update({ auth_user_id: userId }).eq("id", candidate.user_id);
  } else if (candidate.role === "bishop" && candidate.table === "config") {
    // Bishop has no rf_admins row yet — create one so we have a stable profile.
    // pin_hash is legacy-NOT NULL on rf_admins; supply a placeholder since the
    // real credential is in pin_bcrypt. Column is unused by auth going forward.
    const ins = await supa.from("rf_admins").insert({
      email,
      full_name: "Bishop",
      status: "active",
      is_bishop: true,
      auth_user_id: userId,
      pin_bcrypt: candidate.pin_bcrypt,
      pin_hash: "migrated-to-bcrypt",
    }).select("id").single();
    if (!ins.error && ins.data) {
      candidate.user_id = ins.data.id;
    }
  }
  return userId;
}

interface Session {
  access_token:  string;
  refresh_token: string;
  expires_at:    number;
}

async function issueSession(supa: SupabaseClient, email: string): Promise<Session> {
  // Generate a magic-link OTP server-side, then verify it server-side to
  // get a real session. The OTP never leaves the function.
  const link = await supa.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const otp = link.data.properties?.email_otp;
  if (!otp) throw new Error("generateLink returned no email_otp");

  const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const verified = await anonClient.auth.verifyOtp({ email, token: otp, type: "email" });
  if (verified.error) throw verified.error;
  if (!verified.data.session) throw new Error("verifyOtp returned no session");
  return {
    access_token:  verified.data.session.access_token,
    refresh_token: verified.data.session.refresh_token,
    expires_at:    verified.data.session.expires_at ?? 0,
  };
}
