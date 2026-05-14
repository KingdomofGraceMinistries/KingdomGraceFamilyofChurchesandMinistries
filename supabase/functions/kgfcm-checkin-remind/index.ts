// ============================================================
// kgfcm-checkin-remind — Daily check-in reminder cron.
//
// Invoked by pg_cron via net.http_post with the service-role
// bearer. Finds pastors with no check-in in 7+ days, sends each
// a push, and pings the bishop with the overdue list.
//
// Deploy with verify_jwt: true; the cron uses the project's
// service-role JWT which validates.
// ============================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.50.5";
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };
import { corsHeaders, isOriginAllowed, jsonResponse } from "../_shared/cors.ts";
import { audit } from "../_shared/audit.ts";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")              ?? "";
// JWT-format service role first: supabase-js 2.50.5 hands sb_secret_* through to PostgREST as-is and PostgREST rejects non-JWT bearers with 401.
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

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const pastorsRes = await supa.from("rf_pastors")
      .select("id,full_name,last_checkin_at")
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
    await callPushSend({
      user_ids: overdueIds,
      title:    "How are you doing, Pastor?",
      body:     "Your Kingdom Grace family hasn't heard from you in a while. Take a moment to check in — we care about you.",
      icon:     "🕊️",
      screen:   "s-checkin",
      tag:      "checkin-remind",
    });

    const names = overdue.map((p) => p.full_name);
    await callPushSend({
      user_ids: ["bishop"],
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
  await fetch(`${SUPABASE_URL}/functions/v1/kgfcm-push-send`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    body:    JSON.stringify(payload),
  });
}
