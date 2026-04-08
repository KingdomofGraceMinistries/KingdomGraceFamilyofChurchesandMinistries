// ============================================================
// kgfcm-ai-proxy — Claude Haiku AI Proxy for Kingdom Grace
// Supabase Edge Function (Deno runtime)
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 512;

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
        max_tokens: MAX_TOKENS,
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

    default:
      return `You are a helpful assistant for a Christian pastoral network. Be brief, warm, and scripture-grounded. Respond with valid JSON when possible.`;
  }
}
