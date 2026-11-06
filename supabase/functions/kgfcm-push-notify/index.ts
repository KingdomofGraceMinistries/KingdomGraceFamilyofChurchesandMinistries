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

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };
import { corsHeaders, isOriginAllowed, jsonResponse } from "../_shared/cors.ts";
import { audit } from "../_shared/audit.ts";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")              ?? "";
// JWT-format service role first: supabase-js 2.119.0 still hands sb_secret_* through to PostgREST as-is and PostgREST rejects non-JWT bearers with 401.
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SECRET_KEY") ?? "";

type NotifyType = "dm" | "prayer" | "announcement" | "blast" | "win";

interface NotifyData {
  recipient_id?: string;
  sender_name?:  string;
  message_text?: string;
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

    const r = await resolveRecipients(supa);
    // Never notify the person who just posted.
    const others = (ids: string[]) => [...new Set(ids)].filter((id) => id !== callerId);

    let pushPayload: PushPayload;

    switch (type) {
      case "dm": {
        const recipientId = data.recipient_id ?? "";
        const senderName  = data.sender_name  ?? "Someone";
        // A DM to the bishop reaches the bishop, plus the admins when he has
        // chosen that (rf_network_config.dm_notify_admins, bishop-only key).
        // A DM to a pastor reaches that pastor's devices.
        const toBishop = recipientId === "bishop";
        pushPayload = {
          user_ids: others(toBishop
            ? [...r.bishop, ...(r.dmNotifyAdmins ? r.admins : [])]
            : (r.pastorByProfileId.get(recipientId) ? [r.pastorByProfileId.get(recipientId) as string] : [])),
          title:    `New message from ${senderName}`,
          body:     truncate(data.message_text ?? "You have a new message", 100),
          icon:     "✉️",
          screen:   toBishop ? null : "s-dm",
          tag:      `dm-${recipientId}`,
        };
        break;
      }
      case "prayer": {
        // Admins are deliberately excluded: prayer requests are private to
        // pastors and the bishop (the dashboard's Prayer Wall is bishop-only).
        pushPayload = {
          user_ids: others([...r.pastors, ...r.bishop]),
          title:    "New prayer request",
          body:     `${data.pastor_name ?? "A pastor"} shared a prayer request`,
          icon:     "🙏",
          screen:   "s-prayer",
          tag:      "prayer-new",
        };
        break;
      }
      case "announcement": {
        pushPayload = {
          user_ids: others([...r.pastors, ...r.bishop, ...r.admins]),
          title:    "New announcement",
          body:     truncate(data.title ?? data.body ?? "New update posted", 100),
          icon:     "📢",
          screen:   "s-ann",
          tag:      "ann-new",
        };
        break;
      }
      case "blast": {
        pushPayload = {
          user_ids: others(r.pastors),
          title:    "From the Desk of the Bishop",
          body:     truncate(data.message_text ?? "A new word from your Bishop", 100),
          icon:     "👑",
          screen:   "s-home",
          tag:      "blast-new",
        };
        break;
      }
      case "win": {
        pushPayload = {
          user_ids: others([...r.pastors, ...r.bishop, ...r.admins]),
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

    const recipientIds = pushPayload.user_ids as string[];
    if (recipientIds.length === 0) {
      await audit(supa, "PUSH_NOTIFY_OK", { actor_id: callerId, ip_address: ip, notify_type: type, sent: 0, recipients: 0 });
      return jsonResponse(req, { type, sent: 0, recipients: 0 }, 200);
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

// Push subscriptions are keyed by the auth.users id (rf_push_subscriptions RLS
// is user_id = auth.uid()), so every recipient must be resolved to that id —
// never to an rf_pastors/rf_admins profile id or the legacy 'bishop' literal.
// Only active people who have signed in at least once (auth_user_id set) can
// hold a subscription, so the rest are skipped.
interface Recipients {
  pastors:           string[];
  pastorByProfileId: Map<string, string>;
  bishop:            string[];
  admins:            string[];
  dmNotifyAdmins:    boolean;
}

async function resolveRecipients(supa: SupabaseClient): Promise<Recipients> {
  const [pastorsRes, adminsRes, prefRes] = await Promise.all([
    supa.from("rf_pastors").select("id,auth_user_id").eq("status", "active").not("auth_user_id", "is", null),
    supa.from("rf_admins").select("auth_user_id,is_bishop").eq("status", "active").not("auth_user_id", "is", null),
    supa.from("rf_network_config").select("value").eq("key", "dm_notify_admins").maybeSingle(),
  ]);
  if (pastorsRes.error) throw new Error(`recipient lookup (pastors) failed: ${pastorsRes.error.message}`);
  if (adminsRes.error)  throw new Error(`recipient lookup (admins) failed: ${adminsRes.error.message}`);
  if (prefRes.error)    throw new Error(`recipient lookup (dm pref) failed: ${prefRes.error.message}`);

  const pastorRows = (pastorsRes.data ?? []) as Array<{ id: string; auth_user_id: string }>;
  const adminRows  = (adminsRes.data  ?? []) as Array<{ auth_user_id: string; is_bishop: boolean | null }>;
  return {
    pastors:           pastorRows.map((p) => p.auth_user_id),
    pastorByProfileId: new Map(pastorRows.map((p) => [p.id, p.auth_user_id])),
    bishop:            adminRows.filter((a) => a.is_bishop === true).map((a) => a.auth_user_id),
    admins:            adminRows.filter((a) => a.is_bishop !== true).map((a) => a.auth_user_id),
    dmNotifyAdmins:    (prefRes.data as { value?: string } | null)?.value === "true",
  };
}

function truncate(str: string, max: number): string {
  if (!str) return "";
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}
