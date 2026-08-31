// Lock CORS to the allowed origins from the ALLOWED_ORIGINS env var
// (comma-separated). Edge functions reject other origins.
//
// This gate fails closed: if ALLOWED_ORIGINS is unset, empty or mistyped,
// every origin is rejected. Do not add a permissive fallback for that case —
// one existed here until 2026-08-31 and would have silently disabled the
// origin check on all twelve functions the moment the variable was cleared.

const ALLOWED = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = ALLOWED.includes(origin) ? origin : (ALLOWED[0] ?? "");
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key, prefer",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function isOriginAllowed(req: Request): boolean {
  const origin = req.headers.get("origin") ?? "";
  return ALLOWED.includes(origin);
}

export function jsonResponse(
  req: Request,
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json",
    },
  });
}
