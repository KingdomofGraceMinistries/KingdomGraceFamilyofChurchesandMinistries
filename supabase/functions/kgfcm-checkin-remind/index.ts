// ============================================================
// kgfcm-checkin-remind — Automated check-in reminders
// Supabase Edge Function (Deno runtime)
//
// Finds pastors who haven't checked in for 7+ days and sends
// them a push notification reminder. Also flags them for the
// bishop dashboard.
//
// Schedule via Supabase cron: daily at 9am
// select cron.schedule('checkin-remind', '0 14 * * *',
//   $$select net.http_post('https://kseocbwhuveieqhayske.supabase.co/functions/v1/kgfcm-checkin-remind',
//     '{}', 'application/json',
//     ARRAY[net.http_header('Authorization','Bearer SERVICE_ROLE_KEY')]);$$
// );
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Find pastors with no check-in in 7+ days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rf_pastors?select=id,full_name,last_checkin_at&status=eq.active`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    if (!res.ok) {
      return new Response(JSON.stringify({ error: "Failed to fetch pastors" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pastors = await res.json();
    const overdue = pastors.filter(
      (p: { last_checkin_at: string | null }) =>
        !p.last_checkin_at || new Date(p.last_checkin_at) < new Date(sevenDaysAgo)
    );

    if (!overdue.length) {
      return new Response(JSON.stringify({ reminded: 0, message: "All pastors checked in recently" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send push to each overdue pastor
    const overdueIds = overdue.map((p: { id: string }) => p.id);

    await fetch(`${SUPABASE_URL}/functions/v1/kgfcm-push-send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        user_ids: overdueIds,
        title: "How are you doing, Pastor?",
        body: "Your Kingdom Grace family hasn't heard from you in a while. Take a moment to check in — we care about you.",
        icon: "🕊️",
        screen: "s-checkin",
        tag: "checkin-remind",
      }),
    });

    // Also notify bishop about overdue pastors
    const names = overdue.map((p: { full_name: string }) => p.full_name);
    await fetch(`${SUPABASE_URL}/functions/v1/kgfcm-push-send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        user_ids: ["bishop"],
        title: `${overdue.length} pastor${overdue.length > 1 ? "s" : ""} overdue for check-in`,
        body: names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3} more` : ""),
        icon: "⚠️",
        tag: "bishop-overdue-alert",
      }),
    });

    // Log to audit
    await fetch(`${SUPABASE_URL}/rest/v1/rf_audit_log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        event_type: "CHECKIN_REMINDERS_SENT",
        actor_id: "system",
        actor_role: "system",
        metadata: JSON.stringify({ count: overdue.length, pastor_ids: overdueIds }),
      }),
    });

    return new Response(
      JSON.stringify({ reminded: overdue.length, pastors: names }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Checkin remind error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
