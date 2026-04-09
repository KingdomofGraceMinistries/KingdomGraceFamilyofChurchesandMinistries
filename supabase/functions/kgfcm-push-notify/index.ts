// ============================================================
// kgfcm-push-notify — Notification dispatcher for Kingdom Grace
// Supabase Edge Function (Deno runtime)
//
// Called when new content is created (DM, prayer, announcement,
// bishop blast). Determines recipients and calls kgfcm-push-send.
//
// Usage: POST with { type, data }
//   type: "dm" | "prayer" | "announcement" | "blast" | "win"
//   data: relevant fields (sender_name, message_text, etc.)
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
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { type, data } = await req.json();

    if (!type || !data) {
      return new Response(JSON.stringify({ error: "Missing type or data" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let pushPayload: {
      user_ids: string | string[];
      title: string;
      body: string;
      icon?: string;
      screen?: string;
      tag?: string;
    };

    switch (type) {
      case "dm": {
        // Direct message — notify the recipient only
        const recipientId = data.recipient_id;
        const senderName = data.sender_name || "Someone";
        pushPayload = {
          user_ids: [recipientId],
          title: `New message from ${senderName}`,
          body: truncate(data.message_text || "You have a new message", 100),
          icon: "✉️",
          screen: recipientId === "bishop" ? null : "s-dm",
          tag: `dm-${recipientId}`,
        };
        break;
      }

      case "prayer": {
        // New prayer request — notify all users except the poster
        const allPastors = await getAllUserIds();
        const recipients = allPastors.filter((id: string) => id !== data.pastor_id);
        recipients.push("bishop"); // bishop always gets prayer notifications
        pushPayload = {
          user_ids: recipients,
          title: "New prayer request",
          body: `${data.pastor_name || "A pastor"} shared a prayer request`,
          icon: "🙏",
          screen: "s-prayer",
          tag: "prayer-new",
        };
        break;
      }

      case "announcement": {
        // New announcement — notify everyone except poster
        const allUsers = await getAllUserIds();
        const recipients = allUsers.filter((id: string) => id !== data.pastor_id);
        recipients.push("bishop");
        pushPayload = {
          user_ids: recipients,
          title: "New announcement",
          body: truncate(data.title || data.body || "New update posted", 100),
          icon: "📢",
          screen: "s-ann",
          tag: "ann-new",
        };
        break;
      }

      case "blast": {
        // Bishop blast — notify all pastors (not bishop)
        const pastorIds = await getAllUserIds();
        pushPayload = {
          user_ids: pastorIds,
          title: "From the Desk of the Bishop",
          body: truncate(data.message_text || "A new word from your Bishop", 100),
          icon: "👑",
          screen: "s-home",
          tag: "blast-new",
        };
        break;
      }

      case "win": {
        // New win — notify everyone except poster
        const allUsers2 = await getAllUserIds();
        const recipients = allUsers2.filter((id: string) => id !== data.pastor_id);
        recipients.push("bishop");
        pushPayload = {
          user_ids: recipients,
          title: "New victory posted!",
          body: `${data.pastor_name || "A pastor"} shared a win`,
          icon: "🏆",
          screen: "s-wins",
          tag: "win-new",
        };
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown type: ${type}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    // Call the push-send function
    const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/kgfcm-push-send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify(pushPayload),
    });

    const sendResult = await sendRes.json();

    return new Response(JSON.stringify({ type, ...sendResult }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Push notify error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── HELPERS ──

async function getAllUserIds(): Promise<string[]> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rf_pastors?select=id&status=eq.active`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
    if (!res.ok) return [];
    const rows = await res.json();
    return rows.map((r: { id: string }) => r.id);
  } catch {
    return [];
  }
}

function truncate(str: string, max: number): string {
  if (!str) return "";
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}
