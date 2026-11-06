// ============================================================
// kgfcm-checkin-remind — Daily check-in reminder cron.
//
// Invoked server-side (net.http_post) with a secret key on the `apikey`
// header (_shared/server_key.ts). Finds pastors with no check-in in 7+ days,
// sends each a push, and pings the bishop with the overdue list.
//
// Deployed with verify_jwt = false (the platform check only understands
// legacy keys); the secret key is checked in code. Server callers only. No cron job
// schedules it yet (cron.job, 2026-11-06).
//
// Push subscriptions are keyed by auth.users ids, so reminders go to each
// overdue pastor's auth_user_id and the alert to the bishop's — not to
// rf_pastors profile ids or the literal 'bishop', which match no device.
// ============================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };
import { corsHeaders, isOriginAllowed, jsonResponse } from "../_shared/cors.ts";
import { audit } from "../_shared/audit.ts";
import { SECRET_KEY, apikeyOf, isServerCaller } from "../_shared/server_key.ts";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")              ?? "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  // Cron POSTs have no Origin; only reject browser callers with bad origins.
  if (req.headers.get("origin") && !isOriginAllowed(req)) {
    return jsonResponse(req, { error: "Forbidden origin" }, 403);
  }

  const supa: SupabaseClient = createClient(SUPABASE_URL, SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Server callers only — a secret key on the `apikey` header.
  if (!isServerCaller(apikeyOf(req))) {
    await audit(supa, "CHECKIN_REMIND_DENIED", {});
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
    headers: { "Content-Type": "application/json", apikey: SECRET_KEY },
    body:    JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`push-send failed (${res.status})`);
}
