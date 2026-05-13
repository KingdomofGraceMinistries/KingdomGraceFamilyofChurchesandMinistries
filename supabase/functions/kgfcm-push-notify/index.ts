// ============================================================
// kgfcm-push-notify — Notification dispatcher.
//
// Called from authenticated client when content is posted (DM,
// prayer, announcement, blast, win). Resolves recipients and
// delegates to kgfcm-push-send with the service-role bearer.
//
// Requires a valid Supabase Auth JWT (verify_jwt: true at deploy).
// CORS locked via shared module. Audits via server-side audit().
// ============================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };
import { corsHeaders, isOriginAllowed, jsonResponse } from "../_shared/cors.ts";
import { audit } from "../_shared/audit.ts";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")              ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

type NotifyType = "dm" | "prayer" | "announcement" | "blast" | "win";

interface NotifyData {
  recipient_id?: string;
  sender_name?:  string;
  message_text?: string;
  pastor_id?:    string;
  pastor_name?:  string;
  title?:        string;
  body?:         string;
}

interface PushPayload {
  user_ids: string | string[];
  title:    string;
  body:     string;
  icon?:    string;
  screen?:  string | null;
  tag?:     string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (!isOriginAllowed(req))    return jsonResponse(req, { error: "Forbidden origin" }, 403);
  if (req.method !== "POST")    return jsonResponse(req, { error: "Method not allowed" }, 405);

  const supa: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim();

  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return jsonResponse(req, { error: "Missing JWT" }, 401);
  const { data: userData, error: userErr } = await supa.auth.getUser(jwt);
  if (userErr || !userData.user) return jsonResponse(req, { error: "Invalid session" }, 401);
  const callerId = userData.user.id;

  try {
    const { type, data } = (await req.json()) as { type: NotifyType; data: NotifyData };
    if (!type || !data) return jsonResponse(req, { error: "Missing type or data" }, 400);

    let pushPayload: PushPayload;

    switch (type) {
      case "dm": {
        const recipientId = data.recipient_id ?? "";
        const senderName  = data.sender_name  ?? "Someone";
        pushPayload = {
          user_ids: [recipientId],
          title:    `New message from ${senderName}`,
          body:     truncate(data.message_text ?? "You have a new message", 100),
          icon:     "✉️",
          screen:   recipientId === "bishop" ? null : "s-dm",
          tag:      `dm-${recipientId}`,
        };
        break;
      }
      case "prayer": {
        const all = await getAllUserIds(supa);
        const recipients = all.filter((id) => id !== data.pastor_id);
        recipients.push("bishop");
        pushPayload = {
          user_ids: recipients,
          title:    "New prayer request",
          body:     `${data.pastor_name ?? "A pastor"} shared a prayer request`,
          icon:     "🙏",
          screen:   "s-prayer",
          tag:      "prayer-new",
        };
        break;
      }
      case "announcement": {
        const all = await getAllUserIds(supa);
        const recipients = all.filter((id) => id !== data.pastor_id);
        recipients.push("bishop");
        pushPayload = {
          user_ids: recipients,
          title:    "New announcement",
          body:     truncate(data.title ?? data.body ?? "New update posted", 100),
          icon:     "📢",
          screen:   "s-ann",
          tag:      "ann-new",
        };
        break;
      }
      case "blast": {
        const all = await getAllUserIds(supa);
        pushPayload = {
          user_ids: all,
          title:    "From the Desk of the Bishop",
          body:     truncate(data.message_text ?? "A new word from your Bishop", 100),
          icon:     "👑",
          screen:   "s-home",
          tag:      "blast-new",
        };
        break;
      }
      case "win": {
        const all = await getAllUserIds(supa);
        const recipients = all.filter((id) => id !== data.pastor_id);
        recipients.push("bishop");
        pushPayload = {
          user_ids: recipients,
          title:    "New victory posted!",
          body:     `${data.pastor_name ?? "A pastor"} shared a win`,
          icon:     "🏆",
          screen:   "s-wins",
          tag:      "win-new",
        };
        break;
      }
      default:
        return jsonResponse(req, { error: `Unknown type: ${type}` }, 400);
    }

    const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/kgfcm-push-send`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        Authorization:   `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify(pushPayload),
    });
    const sendResult = await sendRes.json();

    await audit(supa, "PUSH_NOTIFY_OK", {
      actor_id: callerId, ip_address: ip, notify_type: type,
      sent: typeof sendResult === "object" && sendResult ? (sendResult as { sent?: number }).sent ?? 0 : 0,
    });
    return jsonResponse(req, { type, ...sendResult }, 200);
  } catch (err) {
    await audit(supa, "PUSH_NOTIFY_ERROR", {
      actor_id: callerId, ip_address: ip,
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});

async function getAllUserIds(supa: SupabaseClient): Promise<string[]> {
  const res = await supa.from("rf_pastors").select("id").eq("status", "active");
  if (res.error || !res.data) return [];
  return res.data.map((r: { id: string }) => r.id);
}

function truncate(str: string, max: number): string {
  if (!str) return "";
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}
