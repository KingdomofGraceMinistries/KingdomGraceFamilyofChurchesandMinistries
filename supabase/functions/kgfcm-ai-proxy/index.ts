// ============================================================
// kgfcm-ai-proxy — Claude Haiku AI proxy for Kingdom Grace
//
// Requires a valid Supabase Auth JWT (verify_jwt: true at deploy).
// Rate-limits per user. Audits success / failure via the shared
// server-side audit() — never console.* (SEC-6).
// ============================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.50.5";
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };
import { corsHeaders, isOriginAllowed, jsonResponse } from "../_shared/cors.ts";
import { audit } from "../_shared/audit.ts";
import { rateLimit } from "../_shared/rate_limit.ts";

const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")              ?? "";
const SERVICE_ROLE_KEY   = Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_API_KEY  = Deno.env.get("ANTHROPIC_API_KEY")         ?? "";
const MODEL              = "claude-haiku-4-5-20251001";
const MAX_TOKENS_DEFAULT = 512;
const MAX_TOKENS_BY_TYPE: Record<string, number> = { outreach: 1500 };

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
  const user = userData.user;

  // Rate-limit AI calls per user — 30/hour is generous; the AI proxy is the
  // most expensive endpoint, both in latency and in Anthropic billing.
  const rl = await rateLimit({ supa, email: user.email ?? user.id, ip, kind: "login" });
  if (rl.limited) {
    await audit(supa, "AI_RATE_LIMITED", { actor_id: user.id, ip_address: ip });
    return jsonResponse(req, { error: "Too many requests. Please slow down." }, 429);
  }

  try {
    const { callType, prompt } = await req.json();
    if (!prompt || !callType) {
      return jsonResponse(req, { error: "Missing callType or prompt" }, 400);
    }
    const systemPrompt = getSystemPrompt(String(callType));
    const maxTokens = MAX_TOKENS_BY_TYPE[String(callType)] ?? MAX_TOKENS_DEFAULT;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: String(prompt) }],
      }),
    });

    if (!response.ok) {
      await audit(supa, "AI_UPSTREAM_ERROR", {
        actor_id: user.id, ip_address: ip,
        status: response.status, call_type: callType,
      });
      return jsonResponse(req, { error: "AI service unavailable" }, 502);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? "";
    let result: unknown;
    try { result = JSON.parse(text); } catch { result = text; }

    await audit(supa, "AI_CALL_OK", { actor_id: user.id, call_type: callType });
    return jsonResponse(req, result, 200);
  } catch (err) {
    await audit(supa, "AI_FN_ERROR", {
      actor_id: user.id, ip_address: ip,
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});

function getSystemPrompt(callType: string): string {
  switch (callType) {
    case "care":
      return `You are a seasoned, compassionate pastoral counselor within a Christian church network.
You speak with the warmth of a trusted elder — never clinical, never secular self-help.
Every response must be scripture-anchored (KJV or NKJV preferred).

When a pastor is struggling, you:
- Acknowledge their humanity and the weight of ministry
- Point to specific scripture for their situation
- Remind them they are not alone — the network stands with them
- Keep it brief (pastors are busy)
- Never undermine church leadership or unity

Respond ONLY with valid JSON in this format:
{"message": "your encouragement here", "verse": "the scripture text", "ref": "Book Chapter:Verse"}`;

    case "team":
      return `You are a pastoral leadership coach generating weekly discussion prompts for a network of pastors.
Your prompts should:
- Be rooted in scripture (KJV or NKJV preferred)
- Spark genuine reflection, not surface-level answers
- Be relevant to the realities of modern pastoral ministry
- Be brief and punchy — one strong question, not three weak ones

If generating a WEEKLY PROMPT, respond ONLY with valid JSON:
{"prompt": "the discussion question", "scripture": "the verse text", "ref": "Book Chapter:Verse", "theme": "one-word theme"}

If generating a MONTHLY CHALLENGE, respond ONLY with valid JSON:
{"title": "short challenge title", "goal": "what to accomplish", "action": "specific measurable action", "scripture": "verse text", "ref": "Book Chapter:Verse"}`;

    case "outreach":
      return `You are a practical research assistant helping a pastor brainstorm creative ways their church can reach Gen Z (born ~1997-2012) and Gen Alpha (born ~2013+). You are NOT prophetic, NOT a "seasoned elder," and NOT seeking the Lord for their flock — you are offering research-informed ideas the pastor can prayerfully consider and adapt.

Voice + tone — non-negotiable:
1. NORMAL, CONVERSATIONAL. Talk like a trusted friend who has read the research — not like a preacher, not like a prophet, not like a marketing consultant. No "thus saith," no "the Lord is calling you," no prophetic framing. No hype, no cringe, no Bible-Belt churchiness.
2. RESEARCH-FRAMED. Lead with what Barna, Springtide, Pew, or general Gen Z research actually shows — e.g., "Research consistently shows Gen Z values authenticity, belonging, and mental-health honesty. Here's one way to incorporate that…" Only claim research findings that are well-documented and widely known; never invent statistics.
3. CONCRETE + CREATIVE. Every suggestion must be a specific, doable idea — not a principle. Think: coffee-house night, young-adult Bible study in the park, church-in-the-park Sunday, pickup basketball + short devotion, open-mic testimony night, mentorship pairs with older members, serve day at a local school, trauma-informed small group, parents-of-teens roundtable. Mix physical-gathering ideas with a few digital/community ones.
4. STILL CHURCH-CENTERED. Every idea should point back to the local church and Jesus — but in a way that feels inviting to someone who isn't already "in." Scripture references are welcome as support for why an idea matters, but keep them short (one verse, not a paragraph), and don't force King-James language unless it fits naturally.
5. CITY-AWARE BUT HONEST. If a city is provided and you actually know something true about it (general size, culture, known needs), weave it in lightly. If you don't, speak in general terms — DO NOT invent local facts, neighborhoods, schools, or statistics.
6. NO COMPROMISE, NO EXTREMES. Don't chase trends for coolness' sake, don't water down the gospel, don't do fear/shame/prosperity manipulation. But also don't be preachy or performatively spiritual.
7. NO HALLUCINATION. If you're not sure of a fact, leave it out. Better short and true than impressive and invented.
8. CONCISE. Each suggestion: 2-4 sentences, concrete enough that a pastor could try it this month.

Respond ONLY with valid JSON in this format:
{"suggestions":[{"title":"short title","body":"2-4 sentence concrete idea","scripture":"short verse text (optional, only if it fits naturally)","ref":"Book Chapter:Verse (optional)"}], "opening":"one short, normal-sounding sentence that frames the context — e.g., 'Research shows a few things really matter to Gen Z right now — here are some creative ways to bring those into your church.'"}

Produce exactly 5 suggestions.`;

    default:
      return `You are a helpful assistant for a Christian pastoral network. Be brief, warm, and scripture-grounded. Respond with valid JSON when possible.`;
  }
}
