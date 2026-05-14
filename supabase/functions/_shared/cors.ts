// Lock CORS to the allowed origins from the ALLOWED_ORIGINS env var
// (comma-separated). Edge functions reject other origins.

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
  // Cutover behavior: when ALLOWED_ORIGINS env var is not set yet, accept
  // any origin so the migration window doesn't lock out the live app.
  // Production MUST set ALLOWED_ORIGINS to the canonical Vercel domain — at
  // that point this branch starts rejecting other origins. Tracked in
  // PROJECT_STATE.md SEC-5.
  if (ALLOWED.length === 0) return true;
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
