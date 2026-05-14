// ============================================================
// kgfcm-audit — Server-side audit writer for the client.
//
// Before SEC-6: client called sbI('rf_audit_log', {...}) directly,
// and actor_id was sourced from local session state — forgeable.
// After SEC-6: client POSTs here; the function reads actor_id and
// actor_role from the verified JWT (auth.uid() + app_metadata.role)
// and writes via service_role. Anon INSERT on rf_audit_log is
// already revoked by the SEC-3 migration; this function is the
// only client-reachable path.
//
// POST body: { event_type: string, target_table?: string,
//              target_id?: string, metadata?: object }
// Requires a valid Supabase Auth JWT in Authorization header.
// ============================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.50.5";
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };
import { corsHeaders, isOriginAllowed, jsonResponse } from "../_shared/cors.ts";
import { audit } from "../_shared/audit.ts";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")              ?? "";
// JWT-format service role first: supabase-js 2.50.5 hands sb_secret_* through to PostgREST as-is and PostgREST rejects non-JWT bearers with 401.
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SECRET_KEY") ?? "";
const EVENT_RE         = /^[A-Z][A-Z0-9_]{0,63}$/;       // SCREAMING_SNAKE_CASE, max 64 chars
const MAX_META_BYTES   = 8192;                            // 8 KB cap per event

interface ClientAuditBody {
  event_type:    string;
  target_table?: string;
  target_id?:    string;
  metadata?:     Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (!isOriginAllowed(req))    return jsonResponse(req, { error: "Forbidden origin" }, 403);
  if (req.method !== "POST")    return jsonResponse(req, { error: "Method not allowed" }, 405);

  // verify_jwt:true at deploy time means Supabase has already verified the
  // bearer JWT before we run; we just decode the claims to get the actor.
  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return jsonResponse(req, { error: "Missing JWT" }, 401);

  const supa: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim();

  try {
    const { data: userData, error: userErr } = await supa.auth.getUser(jwt);
    if (userErr || !userData.user) return jsonResponse(req, { error: "Invalid session" }, 401);
    const user = userData.user;
    const actor_role = (user.app_metadata?.role as string) || "pastor";

    const body = await req.json().catch(() => ({} as ClientAuditBody));
    const eventType = String(body.event_type ?? "");
    if (!EVENT_RE.test(eventType)) {
      return jsonResponse(req, { error: "event_type must match /^[A-Z][A-Z0-9_]{0,63}$/" }, 400);
    }

    const metaSize = body.metadata ? JSON.stringify(body.metadata).length : 0;
    if (metaSize > MAX_META_BYTES) {
      return jsonResponse(req, { error: "metadata too large" }, 413);
    }

    await audit(supa, eventType, {
      actor_id:     user.id,
      actor_role,
      target_table: body.target_table ? String(body.target_table).slice(0, 64) : undefined,
      target_id:    body.target_id    ? String(body.target_id).slice(0, 64)    : undefined,
      ip_address:   ip,
      ...(body.metadata && typeof body.metadata === "object" ? body.metadata : {}),
    });
    return jsonResponse(req, { ok: true }, 200);
  } catch (err) {
    await audit(supa, "AUDIT_FN_ERROR", { ip_address: ip, error: err instanceof Error ? err.message : String(err) });
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});
