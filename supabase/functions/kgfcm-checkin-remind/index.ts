// ============================================================
// kgfcm-checkin-remind — Daily check-in reminder cron.
//
// Invoked by pg_cron via net.http_post with the service-role
// bearer. Finds pastors with no check-in in 7+ days, sends each
// a push, and pings the bishop with the overdue list.
//
// Deploy with verify_jwt: true. Server callers only: the role claim must
// be service_role. No cron job schedules it yet (cron.job, 2026-11-06).
//
// Push subscriptions are keyed by auth.users ids, so reminders go to each
// overdue pastor's auth_user_id and the alert to the bishop's — not to
// rf_pastors profile ids or the literal 'bishop', which match no device.
// ============================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };
import { corsHeaders, isOriginAllowed, jsonResponse } from "../_shared/cors.ts";
import { audit } from "../_shared/audit.ts";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")              ?? "";
// JWT-format service role first: supabase-js 2.119.0 still hands sb_secret_* through to PostgREST as-is and PostgREST rejects non-JWT bearers with 401.
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SECRET_KEY") ?? "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  // Cron POSTs have no Origin; only reject browser callers with bad origins.
  if (req.headers.get("origin") && !isOriginAllowed(req)) {
    return jsonResponse(req, { error: "Forbidden origin" }, 403);
  }

  const supa: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // The gateway verified the signature (verify_jwt: true); read the role.
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const claims = decodeJwtClaims(jwt);
  if (claims?.role !== "service_role") {
    await audit(supa, "CHECKIN_REMIND_DENIED", { actor_id: typeof claims?.sub === "string" ? claims.sub : "unknown", role: claims?.role ?? null });
    return jsonResponse(req, { error: "Forbidden" }, 403);
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const pastorsRes = await supa.from("rf_pastors")
      .select("id,full_name,last_checkin_at,auth_user_id")
      .eq("status", "active");
    if (pastorsRes.error) {
      await audit(supa, "CHECKIN_REMIND_FETCH_FAILED", { error: String(pastorsRes.error) });
      return jsonResponse(req, { error: "Failed to fetch pastors" }, 500);
    }
    const pastors = pastorsRes.data ?? [];
    const overdue = pastors.filter((p) =>
      !p.last_checkin_at || new Date(p.last_checkin_at) < new Date(sevenDaysAgo)
    );

    if (!overdue.length) {
      await audit(supa, "CHECKIN_REMIND_NONE", { count: 0 });
      return jsonResponse(req, { reminded: 0, message: "All pastors checked in recently" }, 200);
    }

    const overdueIds = overdue.map((p) => p.id);
    const overdueAuthIds = overdue.map((p) => p.auth_user_id).filter((x): x is string => !!x);
    const bishopRes = await supa.from("rf_admins").select("auth_user_id")
      .eq("is_bishop", true).eq("status", "active").not("auth_user_id", "is", null);
    if (bishopRes.error) throw new Error(`bishop lookup failed: ${bishopRes.error.message}`);
    const bishopAuthIds = (bishopRes.data ?? []).map((b: { auth_user_id: string }) => b.auth_user_id);

    if (overdueAuthIds.length) await callPushSend({
      user_ids: overdueAuthIds,
      title:    "How are you doing, Pastor?",
      body:     "Your Kingdom Grace family hasn't heard from you in a while. Take a moment to check in — we care about you.",
      icon:     "🕊️",
      screen:   "s-checkin",
      tag:      "checkin-remind",
    });

    const names = overdue.map((p) => p.full_name);
    if (bishopAuthIds.length) await callPushSend({
      user_ids: bishopAuthIds,
      title:    `${overdue.length} pastor${overdue.length > 1 ? "s" : ""} overdue for check-in`,
      body:     names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3} more` : ""),
      icon:     "⚠️",
      tag:      "bishop-overdue-alert",
    });

    await audit(supa, "CHECKIN_REMINDERS_SENT", { count: overdue.length, pastor_ids: overdueIds });
    return jsonResponse(req, { reminded: overdue.length, pastors: names }, 200);
  } catch (err) {
    await audit(supa, "CHECKIN_REMIND_ERROR", { error: err instanceof Error ? err.message : String(err) });
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});

async function callPushSend(payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/kgfcm-push-send`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    body:    JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`push-send failed (${res.status})`);
}

// Read the claims segment of a JWT. Safe without re-verifying the signature
// because this function is deployed with verify_jwt: true — the gateway has
// already validated signature and expiry before the request reaches here.
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
