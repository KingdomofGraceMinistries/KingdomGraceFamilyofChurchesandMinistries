// ============================================================
// kgfcm-push-notify — Notification dispatcher.
//
// Called from the authenticated client right after it saves a DM,
// prayer request, win, announcement, bishop broadcast, fast or
// event. POST { type, id } — the id of the row just written.
//
// The client supplies no notification text and no sender name. The
// row is loaded here, the caller is checked against its author, and
// the title/body come from the database. Before this, the client
// sent sender_name and message_text, so any signed-in user could
// push arbitrary text "from" anyone to everyone. Rows older than
// FRESH_MINUTES are refused so an old id cannot be replayed to spam.
//
// Requires a valid Supabase Auth JWT (verify_jwt: true at deploy).
// CORS locked via shared module. Audits via server-side audit().
// ============================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };
import { corsHeaders, isOriginAllowed, jsonResponse } from "../_shared/cors.ts";
import { audit } from "../_shared/audit.ts";
import { SECRET_KEY } from "../_shared/server_key.ts";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")              ?? "";
const FRESH_MINUTES    = 10;

type NotifyType = "dm" | "prayer" | "announcement" | "blast" | "win" | "fast" | "event";

interface PushPayload {
  user_ids: string[];
  title:    string;
  body:     string;
  icon?:    string;
  screen?:  string | null;
  tag?:     string;
}

// Who is calling, resolved server-side from the verified JWT.
interface Caller {
  authId:    string;
  dashboard: boolean;              // bishop or admin
  pastorId:  string | null;        // rf_pastors.id, when the caller is a pastor
  pastorName: string | null;
}

class Denied extends Error {}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (!isOriginAllowed(req))    return jsonResponse(req, { error: "Forbidden origin" }, 403);
  if (req.method !== "POST")    return jsonResponse(req, { error: "Method not allowed" }, 405);

  const supa: SupabaseClient = createClient(SUPABASE_URL, SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim();

  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return jsonResponse(req, { error: "Missing JWT" }, 401);
  const { data: userData, error: userErr } = await supa.auth.getUser(jwt);
  if (userErr || !userData.user) return jsonResponse(req, { error: "Invalid session" }, 401);
  const callerId = userData.user.id;
  const role = userData.user.app_metadata?.role;

  let type: NotifyType | undefined;
  try {
    const body = await req.json() as { type?: NotifyType; id?: string };
    type = body.type;
    const id = String(body.id ?? "").trim();
    if (!type || !id) return jsonResponse(req, { error: "Missing type or id" }, 400);

    const caller = await resolveCaller(supa, callerId, role);
    const r = await resolveRecipients(supa);
    // Never notify the person who just posted.
    const others = (ids: string[]) => [...new Set(ids)].filter((x) => x !== callerId);

    let pushPayload: PushPayload;

    switch (type) {
      case "dm": {
        const m = await loadFresh(supa, "rf_direct_messages", "id,sender_id,recipient_id,message_text,created_at", id, "created_at");
        let senderName: string;
        if (m.sender_id === "bishop") {
          if (!caller.dashboard) throw new Denied("only the bishop's office sends as the bishop");
          senderName = await bishopDisplayName(supa);
        } else {
          if (!caller.pastorId || m.sender_id !== caller.pastorId) throw new Denied("caller did not send this message");
          senderName = caller.pastorName ?? "A pastor";
        }
        // A DM to the bishop reaches the bishop, plus the admins when he has
        // chosen that (rf_network_config.dm_notify_admins, bishop-only key).
        // A DM to a pastor reaches that pastor's devices.
        const recipientId = String(m.recipient_id ?? "");
        const toBishop = recipientId === "bishop";
        const pastorAuth = r.pastorByProfileId.get(recipientId);
        pushPayload = {
          user_ids: others(toBishop
            ? [...r.bishop, ...(r.dmNotifyAdmins ? r.admins : [])]
            : (pastorAuth ? [pastorAuth] : [])),
          title:    `New message from ${senderName}`,
          body:     truncate(String(m.message_text ?? "") || "You have a new message", 100),
          icon:     "✉️",
          screen:   toBishop ? null : "s-dm",
          tag:      `dm-${recipientId}`,
        };
        break;
      }
      case "prayer": {
        const p = await loadFresh(supa, "rf_prayer_requests", "id,pastor_id,created_at", id, "created_at");
        if (!caller.pastorId || p.pastor_id !== caller.pastorId) throw new Denied("caller did not post this prayer request");
        // Admins are deliberately excluded: prayer requests are private to
        // pastors and the bishop (the dashboard's Prayer Wall is bishop-only).
        pushPayload = {
          user_ids: others([...r.pastors, ...r.bishop]),
          title:    "New prayer request",
          body:     `${caller.pastorName ?? "A pastor"} shared a prayer request`,
          icon:     "🙏",
          screen:   "s-prayer",
          tag:      "prayer-new",
        };
        break;
      }
      case "win": {
        const w = await loadFresh(supa, "rf_wins", "id,pastor_id,created_at", id, "created_at");
        if (!caller.pastorId || w.pastor_id !== caller.pastorId) throw new Denied("caller did not post this win");
        pushPayload = {
          user_ids: others([...r.pastors, ...r.bishop, ...r.admins]),
          title:    "New victory posted!",
          body:     `${caller.pastorName ?? "A pastor"} shared a win`,
          icon:     "🏆",
          screen:   "s-wins",
          tag:      "win-new",
        };
        break;
      }
      case "announcement": {
        const a = await loadFresh(supa, "rf_announcements", "id,pastor_id,title,body,created_at", id, "created_at");
        const byOffice = a.pastor_id === "bishop";
        if (byOffice ? !caller.dashboard : (!caller.pastorId || a.pastor_id !== caller.pastorId)) {
          throw new Denied("caller did not post this announcement");
        }
        pushPayload = {
          user_ids: others([...r.pastors, ...r.bishop, ...r.admins]),
          title:    "New announcement",
          body:     truncate(String(a.title ?? "") || String(a.body ?? "") || "New update posted", 100),
          icon:     "📢",
          screen:   "s-ann",
          tag:      "ann-new",
        };
        break;
      }
      case "blast":
      case "fast":
      case "event": {
        if (!caller.dashboard) throw new Denied("only the bishop's office sends network-wide notices");
        let text: string;
        if (type === "blast") {
          const b = await loadFresh(supa, "rf_bishop_messages", "id,message_text,sent_at", id, "sent_at");
          text = String(b.message_text ?? "") || "(voice message)";
        } else if (type === "fast") {
          const f = await loadFresh(supa, "rf_fasts", "id,title,created_at", id, "created_at");
          text = `📣 The Bishop has declared a fast: ${String(f.title ?? "")}`;
        } else {
          const e = await loadFresh(supa, "rf_events", "id,title,event_date,created_at", id, "created_at");
          text = `📅 New event: ${String(e.title ?? "")} on ${String(e.event_date ?? "")}`;
        }
        pushPayload = {
          user_ids: others(r.pastors),
          title:    "From the Desk of the Bishop",
          body:     truncate(text, 100),
          icon:     "👑",
          screen:   "s-home",
          tag:      `${type}-new`,
        };
        break;
      }
      default:
        return jsonResponse(req, { error: `Unknown type: ${type}` }, 400);
    }

    if (pushPayload.user_ids.length === 0) {
      await audit(supa, "PUSH_NOTIFY_OK", { actor_id: callerId, ip_address: ip, notify_type: type, sent: 0, recipients: 0 });
      return jsonResponse(req, { type, sent: 0, recipients: 0 }, 200);
    }

    const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/kgfcm-push-send`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        apikey:          SECRET_KEY,
      },
      body: JSON.stringify(pushPayload),
    });
    if (!sendRes.ok) throw new Error(`push-send failed (${sendRes.status})`);
    const sendResult = await sendRes.json();

    await audit(supa, "PUSH_NOTIFY_OK", {
      actor_id: callerId, ip_address: ip, notify_type: type,
      sent: typeof sendResult === "object" && sendResult ? (sendResult as { sent?: number }).sent ?? 0 : 0,
    });
    return jsonResponse(req, { type, ...sendResult }, 200);
  } catch (err) {
    if (err instanceof Denied) {
      await audit(supa, "PUSH_NOTIFY_DENIED", { actor_id: callerId, ip_address: ip, notify_type: type ?? null, reason: err.message });
      return jsonResponse(req, { error: "Forbidden" }, 403);
    }
    await audit(supa, "PUSH_NOTIFY_ERROR", {
      actor_id: callerId, ip_address: ip,
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});

async function resolveCaller(supa: SupabaseClient, authId: string, role: unknown): Promise<Caller> {
  const dashboard = role === "bishop" || role === "admin";
  if (dashboard) return { authId, dashboard, pastorId: null, pastorName: null };
  const res = await supa.from("rf_pastors").select("id,full_name").eq("auth_user_id", authId).eq("status", "active").maybeSingle();
  if (res.error) throw new Error(`caller lookup failed: ${res.error.message}`);
  const row = res.data as { id: string; full_name: string | null } | null;
  return { authId, dashboard, pastorId: row?.id ?? null, pastorName: row?.full_name ?? null };
}

// Load the row the client says it just wrote. Missing or older than
// FRESH_MINUTES is refused, so an old id cannot be replayed for spam.
async function loadFresh(
  supa: SupabaseClient, table: string, cols: string, id: string, tsCol: string,
): Promise<Record<string, unknown>> {
  const res = await supa.from(table).select(cols).eq("id", id).maybeSingle();
  if (res.error) throw new Error(`${table} lookup failed: ${res.error.message}`);
  const row = res.data as Record<string, unknown> | null;
  if (!row) throw new Denied(`${table} row not found`);
  const ts = Date.parse(String(row[tsCol] ?? ""));
  if (!Number.isFinite(ts) || Date.now() - ts > FRESH_MINUTES * 60 * 1000) {
    throw new Denied(`${table} row is not new`);
  }
  return row;
}

async function bishopDisplayName(supa: SupabaseClient): Promise<string> {
  const res = await supa.from("rf_network_config").select("value").eq("key", "bishop_name").maybeSingle();
  if (res.error) throw new Error(`bishop name lookup failed: ${res.error.message}`);
  return (res.data as { value?: string } | null)?.value || "the Bishop";
}

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
