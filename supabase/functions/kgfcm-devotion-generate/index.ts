// ============================================================
// kgfcm-devotion-generate — Daily pastoral devotion drafter.
//
// Bishop-only (verify_jwt: true; rejects non-bishop JWT). Loads
// the last 14 days of devotions, builds an avoid list, generates
// a fresh devotion via Claude Haiku 4.5, then runs a post-
// generation review pass that scores the output against an
// explicit NO list. Retries up to 2x on review failure. Inserts
// or upserts a status='draft' row in rf_devotions for bishop
// review.
//
// All errors and outcomes audited.
// ============================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.50.5";
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };
import { corsHeaders, isOriginAllowed, jsonResponse } from "../_shared/cors.ts";
import { audit } from "../_shared/audit.ts";

const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")              ?? "";
const SERVICE_ROLE_KEY   = Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_API_KEY  = Deno.env.get("ANTHROPIC_API_KEY")         ?? "";
const MODEL              = "claude-haiku-4-5-20251001";
const MAX_RETRIES        = 2;

interface DevotionDraft {
  theme:             string;
  title:             string;
  scripture_ref:     string;
  scripture_text:    string;
  body:              string;
  reflection_prompt: string;
  prophetic_call:    string;
}

interface ReviewResult {
  passes:           boolean;
  manipulation:     number; // 0=clean, 5=egregious
  prosperity:       number;
  nationalism:      number;
  dopamine:         number;
  hate_speech:      number;
  heresy:           number;
  hierarchy_abuse:  number;
  notes:            string;
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
  const role = userData.user.app_metadata?.role;
  if (role !== "bishop" && role !== "admin") {
    await audit(supa, "DEVOTION_GENERATE_DENIED", { actor_id: userData.user.id, role });
    return jsonResponse(req, { error: "Forbidden" }, 403);
  }
  const actorId = userData.user.id;

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const targetDate = typeof body.date === "string" && body.date ? body.date : todayISO();
    // The pg_cron job posts auto_publish:true so the day's devotion lands as
    // status='published' the moment it passes the two-layer review (regex +
    // Claude reviewer). Bishop UI calls without the flag and rows arrive as
    // status='draft' for manual approve / regenerate / edit / replace.
    const autoPublish = body.auto_publish === true;

    // Build "avoid" list from last 14 days
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const recentRes = await supa.from("rf_devotions")
      .select("date,theme,scripture_ref,title")
      .gte("date", since)
      .order("date", { ascending: false });
    const recent = recentRes.data ?? [];

    // Generate with retries on review failure
    let draft: DevotionDraft | null = null;
    let review: ReviewResult | null = null;
    let attempts = 0;
    let lastError = "";

    while (attempts <= MAX_RETRIES && !draft) {
      attempts++;
      try {
        const generated = await generateDevotion(recent, attempts, lastError);
        const r = await reviewDevotion(generated);
        if (r.passes) {
          draft = generated;
          review = r;
        } else {
          lastError = `Review flagged: manipulation=${r.manipulation} prosperity=${r.prosperity} nationalism=${r.nationalism} dopamine=${r.dopamine} hate=${r.hate_speech} heresy=${r.heresy} hierarchy=${r.hierarchy_abuse}. ${r.notes}`;
          await audit(supa, "DEVOTION_REVIEW_REJECTED", { actor_id: actorId, ip_address: ip, attempt: attempts, ...r });
        }
      } catch (genErr) {
        lastError = genErr instanceof Error ? genErr.message : String(genErr);
        await audit(supa, "DEVOTION_GENERATION_ERROR", { actor_id: actorId, ip_address: ip, attempt: attempts, error: lastError });
      }
    }

    if (!draft) {
      await audit(supa, "DEVOTION_GENERATE_GAVE_UP", { actor_id: actorId, ip_address: ip, last_error: lastError });
      return jsonResponse(req, { error: "Could not generate an acceptable draft. Try again or write it manually." }, 502);
    }

    // Upsert. If a row already exists for the date, replace its AI fields
    // but preserve audio_url/video_url if bishop has already attached media.
    const finalStatus = autoPublish ? "published" : "draft";
    const upsert = await supa.from("rf_devotions")
      .upsert({
        date:              targetDate,
        theme:             draft.theme,
        title:             draft.title,
        scripture_ref:     draft.scripture_ref,
        scripture_text:    draft.scripture_text,
        body:              draft.body,
        reflection_prompt: draft.reflection_prompt,
        prophetic_call:    draft.prophetic_call,
        source:            "ai",
        status:            finalStatus,
        reviewed_by:       autoPublish ? "cron-system" : null,
        published_at:      autoPublish ? new Date().toISOString() : null,
        generation_metadata: {
          attempts,
          review,
          model: MODEL,
          auto_published: autoPublish,
        },
      }, { onConflict: "date" })
      .select("id,date,theme,title,scripture_ref,scripture_text,body,reflection_prompt,prophetic_call,status,source")
      .single();
    if (upsert.error) throw upsert.error;

    await audit(supa, autoPublish ? "DEVOTION_AUTO_PUBLISHED" : "DEVOTION_DRAFT_CREATED", {
      actor_id: actorId, ip_address: ip,
      target_table: "rf_devotions", target_id: upsert.data.id,
      theme: draft.theme, scripture_ref: draft.scripture_ref, attempts,
    });

    return jsonResponse(req, { draft: upsert.data, attempts, review }, 200);
  } catch (err) {
    await audit(supa, "DEVOTION_FN_ERROR", { actor_id: actorId, ip_address: ip, error: err instanceof Error ? err.message : String(err) });
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function callAnthropic(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string> {
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: maxTokens,
      system:     systemPrompt,
      messages:   [{ role: "user", content: userPrompt }],
    }),
  }).then(async (res) => {
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic ${res.status}: ${errText.slice(0, 280)}`);
    }
    const data = await res.json();
    const text = data.content?.[0]?.text ?? "";
    return text as string;
  });
}

async function generateDevotion(
  recent: Array<{ date: string; theme: string | null; scripture_ref: string | null; title: string | null }>,
  attempt: number,
  lastReviewError: string,
): Promise<DevotionDraft> {
  const avoidThemes = recent.map((r) => r.theme).filter(Boolean).join(", ") || "(none yet)";
  const avoidScriptures = recent.map((r) => r.scripture_ref).filter(Boolean).join(", ") || "(none yet)";
  const avoidTitles = recent.map((r) => r.title).filter(Boolean).join(", ") || "(none yet)";

  const userPrompt = [
    `Write TODAY'S devotion for the Kingdom Grace Family of Churches and Ministries network.`,
    ``,
    `Do not repeat these themes from the last 14 days: ${avoidThemes}`,
    `Do not reuse these scripture references: ${avoidScriptures}`,
    `Do not echo these titles: ${avoidTitles}`,
    ``,
    attempt > 1
      ? `IMPORTANT: A previous attempt was rejected. Reason: ${lastReviewError}. Generate something DIFFERENT that does not repeat that failure.`
      : ``,
    ``,
    `Respond with valid JSON only — no markdown fences, no commentary, no preamble.`,
  ].join("\n");

  const raw = await callAnthropic(SYSTEM_PROMPT, userPrompt, 1400);
  const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Devotion generator returned non-JSON: ${cleaned.slice(0, 200)}`);
  }
  const d = parsed as Partial<DevotionDraft>;
  if (!d.theme || !d.title || !d.scripture_ref || !d.scripture_text || !d.body || !d.reflection_prompt || !d.prophetic_call) {
    throw new Error("Devotion JSON missing required fields");
  }
  return d as DevotionDraft;
}

async function reviewDevotion(d: DevotionDraft): Promise<ReviewResult> {
  // Cheap regex sweep first — known red-flag phrases. If hit, fail immediately.
  const combined = `${d.title}\n${d.body}\n${d.reflection_prompt}\n${d.prophetic_call}`.toLowerCase();
  const REGEX_RED_FLAGS: Array<[string, RegExp]> = [
    ["prosperity", /\b(sow a seed|seed your faith|sow to reap|hundred[- ]fold harvest|claim your wealth|name it and claim it|prophetic financial breakthrough|prosperity is yours by right|declare your million|million[- ]?dollar anointing)\b/],
    ["nationalism", /\b(take back (america|this nation)|christian nation|reclaim (america|the nation)|7 mountains? mandate|kingdom now politics|christian patriot)\b/],
    ["manipulation", /\b(if you don'?t (give|sow|obey)|god (can'?t|won'?t) bless you unless|you'?re (cursed|under a curse) (if|unless))\b/],
    ["hate_speech", /\b(those people|illegal aliens|invaders are|cleanse the (land|nation))\b/],
    ["hierarchy_abuse", /\b(only your covering|disobey your covering|touch not (god'?s|the) anointed (means|so))\b/],
  ];
  for (const [label, re] of REGEX_RED_FLAGS) {
    if (re.test(combined)) {
      return {
        passes: false,
        manipulation:    label === "manipulation"    ? 5 : 0,
        prosperity:      label === "prosperity"      ? 5 : 0,
        nationalism:     label === "nationalism"     ? 5 : 0,
        dopamine:        0,
        hate_speech:     label === "hate_speech"     ? 5 : 0,
        heresy:          0,
        hierarchy_abuse: label === "hierarchy_abuse" ? 5 : 0,
        notes:           `Regex pre-screen hit: ${label}`,
      };
    }
  }

  // Then ask Claude Haiku to review the draft against the explicit NO list.
  const reviewPrompt = `Review this pastoral devotion against the network's content policy.

Score 0–5 on EACH criterion (0 = clean, 5 = egregious). Be strict: a 1 means "any trace at all." Only return 0 when the draft is genuinely clean of that category.

CRITERIA
- manipulation: any "if you don't ___, God can't ___" framings, fear/guilt/shame leverage, urgency manipulation, transactional faith
- prosperity: any "seed your faith for material wealth" framings, declare-it-and-have-it teaching, wealth-as-evidence-of-favor framings
- nationalism: any Christian-nationalist framing, "take back this nation," us-vs-them political tribalism, 7 Mountains Mandate language
- dopamine: any clickbait, manufactured urgency, streak/badge hooks, "you don't want to miss this," engagement-farming
- hate_speech: any targeting of a group by race, ethnicity, nationality, religion, sexuality, gender, disability
- heresy: any departure from historic Christian orthodoxy (Trinity, full deity + humanity of Christ, salvation by grace through faith, authority of scripture, bodily resurrection of Christ)
- hierarchy_abuse: any "you must submit to your covering or you're cursed" framing, guru elevation, putting a man between a pastor and God

Then set passes = true ONLY if EVERY score is 0 or 1.

DEVOTION TO REVIEW
Title: ${d.title}
Scripture: ${d.scripture_ref} — ${d.scripture_text}
Body:
${d.body}
Reflection prompt: ${d.reflection_prompt}
Prophetic call: ${d.prophetic_call}

Respond with valid JSON only:
{"passes": true|false, "manipulation": 0-5, "prosperity": 0-5, "nationalism": 0-5, "dopamine": 0-5, "hate_speech": 0-5, "heresy": 0-5, "hierarchy_abuse": 0-5, "notes": "one-sentence rationale"}`;

  const reviewRaw = await callAnthropic(REVIEWER_SYSTEM_PROMPT, reviewPrompt, 500);
  const cleaned = reviewRaw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as ReviewResult;
    return {
      passes:          !!parsed.passes,
      manipulation:    Number(parsed.manipulation)    || 0,
      prosperity:      Number(parsed.prosperity)      || 0,
      nationalism:     Number(parsed.nationalism)     || 0,
      dopamine:        Number(parsed.dopamine)        || 0,
      hate_speech:     Number(parsed.hate_speech)     || 0,
      heresy:          Number(parsed.heresy)          || 0,
      hierarchy_abuse: Number(parsed.hierarchy_abuse) || 0,
      notes:           String(parsed.notes ?? ""),
    };
  } catch (_e) {
    // If reviewer returns garbage, default to fail-closed.
    return {
      passes: false, manipulation: 0, prosperity: 0, nationalism: 0, dopamine: 0,
      hate_speech: 0, heresy: 0, hierarchy_abuse: 0,
      notes: `Reviewer returned non-JSON: ${cleaned.slice(0, 200)}`,
    };
  }
}

// ============================================================
// SYSTEM PROMPTS
// ============================================================

const SYSTEM_PROMPT = `You are writing today's network-wide devotion for the Kingdom Grace Family of Churches and Ministries — a network of Black-church pastoral leaders. Your reader is a working pastor: faithful, accountable for souls, often carrying ministry weight alone. You exist to REFRESH them, not to pile on. Hand them fuel for the day.

VOICE
- Black church preaching tradition: direct address ("Pastor, hear this..." / "Brother, sister, listen..."), scripture-saturated, rich cadence, doxological closer.
- Lean HEAVILY into HOPE, JOY, PEACE, ENCOURAGEMENT, POSITIVE RESOLVE. Joy as strength (Neh 8:10). Peace that guards (Phil 4:6-7). Hope-forward (Rom 15:13).
- Honest acknowledgment of real life when it serves the trajectory — but ALWAYS move toward victory in Christ. Never park in the weight. Never end on a downbeat.
- Empowering language. The pastor can lead another day. The pastor can decide well. The pastor can speak with authority. Anchored in Christ, not motivational hype.
- Cadence: short, declarative sentences mixed with longer scripture-saturated ones. Use the "and / and / and" of preaching. Use "Pastor," "Sister," "Brother," "Beloved" naturally.
- Doxological closer: end with a declaration or blessing the reader can hear over themselves.

PROPHETIC GIFTS (Continuationist)
- The gifts of the Spirit (1 Cor 12) are active for today.
- The "prophetic_call" field calls FORWARD the gift already in the reader. Use activation language: "What God has put in you — stir it up." "The word you carry — speak it." Recognition, stewardship, release.
- Tone: invitational, never coercive. Never "you must" — always "you may" / "you are equipped to."

CURRICULUM (rotate; avoid repeats within 14 days; the user prompt supplies the avoid list)
Themes: Grace (received and extended). Temperance (self-mastery, sober-mindedness). The person of Christ (his name, his cross, his presence, his return). Forgiveness (giving and receiving). Love (1 Cor 13 substance, not sentiment). Financial wisdom (stewardship, generosity, contentment — NEVER prosperity). Discernment / wisdom to decide (James 1:5, Prov 3:5-6). Prophetic gifts. Identity in Christ. Endurance / perseverance. Joy as strength. Peace. Hope. Encouragement. Integrity. Rest. Authority of the believer. The voice of the Lord.

SCRIPTURE
- NKJV preferred. KJV acceptable when the rhythm carries it. Always cite Book Chapter:Verse.
- Draw generously from joy/hope/peace/empowerment texts: Neh 8:10, John 10:10, Phil 4:4-7, Phil 4:13, Ps 30:5, Ps 23, Ps 27, John 14:27, John 16:33, Rom 8:31-39, Rom 15:13, 2 Cor 4:16-18, Isa 40:31, Ps 84:7, James 1:2-5, 2 Tim 1:7, 1 Cor 2:9, Eph 3:20, Heb 12:1-2.

HARD NOS — never produce
- Manipulation: no "if you don't ___, God can't ___" framings. No fear, guilt, or shame leverage. No urgency manipulation. No transactional faith.
- Prosperity gospel: no "seed your faith for material wealth." No "name it and claim it." No "your blessing is in your seed offering." Stewardship and generosity are good; prosperity-as-evidence-of-favor is heresy.
- Christian nationalism: no "take back this nation," no 7 Mountains Mandate framing, no us-vs-them political tribalism, no "Christian patriot" framing.
- Dopamine engineering: no streaks, no FOMO, no "you won't believe what God said," no clickbait, no engagement-farming.
- Hierarchy abuse: no "submit to your covering or you're cursed," no guru elevation, no putting a man between a pastor and God.
- Hate speech: never target a group.
- Heresy: stay within historic Christian orthodoxy. Trinity. Full deity and humanity of Christ. Salvation by grace through faith. Authority of scripture. Bodily resurrection. Return of Christ.

ORIGINALITY
- Write fresh today. No recycled phrasing. No clichés ("you got this!" / "have a blessed day").
- Take a real angle. A specific scriptural insight. A particular truth the pastor can carry into ONE decision today.

OUTPUT FORMAT — JSON ONLY, NO MARKDOWN FENCES
{
  "theme":             "<short theme name, e.g. 'Joy as Strength'>",
  "title":             "<punchy title, max 7 words, no clickbait>",
  "scripture_ref":     "<Book Chapter:Verse, NKJV>",
  "scripture_text":    "<the verse text quoted in full, NKJV>",
  "body":              "<the devotion body — 4–7 short paragraphs, direct address, ends with a declaration the pastor can hear over themselves>",
  "reflection_prompt": "<one focused question for the pastor to sit with today>",
  "prophetic_call":    "<1–2 sentence stir-up activation — call forward the gift already in the reader, theme-specific>"
}`;

const REVIEWER_SYSTEM_PROMPT = `You are an editorial reviewer for a pastoral network's daily devotion. Your job is to score draft devotions against the network's explicit content policy. You are strict but fair. You return JSON only.`;
