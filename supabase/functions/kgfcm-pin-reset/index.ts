// ============================================================
// kgfcm-pin-reset — Send a PIN-reset code via Resend.
//
// Replaces the legacy "echo the code into the browser" flow.
// POST { email }; verify_jwt: false (forgot-PIN has no JWT).
//
// Flow:
//   1. CORS + rate-limit (per email + per IP).
//   2. Look up rf_pastors / rf_admins / bishop_email by email.
//   3. Whether found or not, sleep to constant time.
//   4. If found: generate CSPRNG 8-hex code, store SHA-256(code)
//      in reset_token_hash + expires = now + 30 min, send via
//      Resend to the email-on-file.
//   5. Always respond { sent: true } regardless — never confirm
//      or deny the email is registered (enumeration defense).
//   6. Audit every path.
// ============================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.50.5";
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };
import { corsHeaders, isOriginAllowed, jsonResponse } from "../_shared/cors.ts";
import { audit } from "../_shared/audit.ts";
import { rateLimit, padTo, generateCode, hashCode } from "../_shared/rate_limit.ts";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")              ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY   = Deno.env.get("RESEND_API_KEY")            ?? "";
const RESEND_FROM      = Deno.env.get("RESEND_FROM")               ?? "Kingdom Grace <noreply@kingdomgracefamily.com>";
const NETWORK_SHORT    = Deno.env.get("NETWORK_SHORT")             ?? "Kingdom Grace";
const MIN_RESPONSE_MS  = 600;
const EMAIL_RE         = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CODE_TTL_MIN     = 30;

interface ResetTarget {
  table: "rf_pastors" | "rf_admins";
  id:    string;
  email: string;
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
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      await audit(supa, "RESET_BAD_INPUT", { ip_address: ip });
      await padTo(started, MIN_RESPONSE_MS);
      return jsonResponse(req, { sent: true }, 200); // constant-time
    }

    const rl = await rateLimit({ supa, email, ip, kind: "reset" });
    if (rl.limited) {
      await audit(supa, "RESET_RATE_LIMITED", { ip_address: ip });
      await padTo(started, MIN_RESPONSE_MS);
      return jsonResponse(req, { sent: true }, 200);
    }

    const target = await findResetTarget(supa, email);

    if (target) {
      const code     = generateCode(4);                  // 8 hex chars (4B combos)
      const hash     = await hashCode(code);
      const expires  = new Date(Date.now() + CODE_TTL_MIN * 60 * 1000).toISOString();

      const upd = await supa.from(target.table)
        .update({ reset_token_hash: hash, reset_token_expires: expires })
        .eq("id", target.id);
      if (upd.error) {
        await audit(supa, "RESET_DB_WRITE_FAILED", { ip_address: ip, error: String(upd.error) });
      } else {
        const emailRes = await sendResetEmail(target.email, code);
        await audit(supa, "RESET_CODE_SENT", {
          ip_address:   ip,
          target_table: target.table,
          target_id:    target.id,
          delivered:    emailRes.ok,
          send_status:  emailRes.status,
          resend_id:    emailRes.id,
          send_error:   emailRes.error,
        });
      }
    } else {
      await audit(supa, "RESET_UNKNOWN_EMAIL", { ip_address: ip });
    }

    await padTo(started, MIN_RESPONSE_MS);
    return jsonResponse(req, { sent: true }, 200);
  } catch (err) {
    await audit(supa, "RESET_FN_ERROR", { ip_address: ip, error: err instanceof Error ? err.message : String(err) });
    await padTo(started, MIN_RESPONSE_MS);
    return jsonResponse(req, { sent: true }, 200);
  }
});

async function findResetTarget(supa: SupabaseClient, email: string): Promise<ResetTarget | null> {
  // Bishop singleton: matches rf_network_config.bishop_email. The rf_admins
  // row for the bishop is created during first PIN login; if it doesn't
  // exist yet, we can't store a reset hash, so we fail-soft.
  const cfg = await supa.from("rf_network_config").select("value").eq("key", "bishop_email").maybeSingle();
  const bishopEmail = String(cfg.data?.value ?? "").trim().toLowerCase();
  if (bishopEmail && bishopEmail === email) {
    const ad = await supa.from("rf_admins").select("id,email").eq("email", email).eq("is_bishop", true).maybeSingle();
    if (ad.data) return { table: "rf_admins", id: ad.data.id, email };
  }

  const admin = await supa.from("rf_admins").select("id,email,status").eq("email", email).eq("status", "active").maybeSingle();
  if (admin.data) return { table: "rf_admins", id: admin.data.id, email };

  const pastor = await supa.from("rf_pastors").select("id,email,status").eq("email", email).eq("status", "active").maybeSingle();
  if (pastor.data) return { table: "rf_pastors", id: pastor.data.id, email };

  return null;
}

async function sendResetEmail(to: string, code: string): Promise<{ ok: boolean; status: number; id?: string; error?: string }> {
  if (!RESEND_API_KEY) return { ok: false, status: 0, error: "RESEND_API_KEY not set" };
  const subject = `Your ${NETWORK_SHORT} PIN reset code`;
  const text = [
    `Your ${NETWORK_SHORT} PIN reset code is:`,
    ``,
    `    ${code}`,
    ``,
    `This code expires in ${CODE_TTL_MIN} minutes. If you did not request a reset, you can ignore this email.`,
    ``,
    `— ${NETWORK_SHORT}`,
  ].join("\n");
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.5;padding:24px;max-width:480px;margin:0 auto">
    <h2 style="font-family:Georgia,serif;color:#8a6a1c;margin:0 0 16px">${NETWORK_SHORT}</h2>
    <p>Your PIN reset code is:</p>
    <p style="font-size:28px;font-weight:600;letter-spacing:4px;background:#f5f1e6;padding:14px 20px;border-radius:8px;text-align:center;margin:20px 0">${code}</p>
    <p style="color:#666;font-size:14px">This code expires in ${CODE_TTL_MIN} minutes. If you did not request a reset, you can ignore this email.</p>
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
