// ============================================================
// kgfcm-ai-proxy — Claude Haiku AI Proxy for Kingdom Grace
// Supabase Edge Function (Deno runtime)
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS_DEFAULT = 512;
const MAX_TOKENS_BY_TYPE: Record<string, number> = {
  outreach: 1500,
};

// CORS headers — restrict to your domains in production
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  // Handle CORS preflight
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
    const { callType, prompt } = await req.json();

    if (!prompt || !callType) {
      return new Response(JSON.stringify({ error: "Missing callType or prompt" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build the system prompt based on call type
    const systemPrompt = getSystemPrompt(callType);
    const maxTokens = MAX_TOKENS_BY_TYPE[callType] || MAX_TOKENS_DEFAULT;

    // Call Claude Haiku
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
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Claude API error:", response.status, errText);
      return new Response(JSON.stringify({ error: "AI service unavailable" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "";

    // Try to parse as JSON (prompts return structured data)
    let result: unknown;
    try {
      result = JSON.parse(text);
    } catch {
      result = text;
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ============================================================
// SYSTEM PROMPTS BY CALL TYPE
// ============================================================

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
