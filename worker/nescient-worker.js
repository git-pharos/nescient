<![CDATA[/**
 * NESCIENT Proxy Worker — Groq Edition
 * ─────────────────────────────────────────────────────
 * Accepts a { question } POST from the frontend, calls the
 * Groq API with your key (stored securely server-side),
 * and returns { text } with NESCIENT's wrong answer.
 *
 * SETUP — one environment variable required:
 *   GROQ_API_KEY  →  your key from console.groq.com
 *                    (add it as a Secret in Worker settings)
 *
 * OPTIONAL — replace * with your domain for tighter security:
 *   const ALLOWED_ORIGIN = "https://yourdomain.com";
 * ─────────────────────────────────────────────────────
 *
 * DEPLOY: this Worker is deployed via `wrangler deploy` from
 * this directory (worker/). It is NOT Git-connected — do not
 * reconnect it to Cloudflare's Git integration; that has twice
 * caused this Worker to be misclassified as a static-assets
 * Worker, breaking secrets and the API entirely. See
 * git-pharos/nescient README for details.
 */

const ALLOWED_ORIGIN = "*";

// Default model. Groq retires models periodically
// (see console.groq.com/docs/deprecations). Override without a redeploy
// by setting a GROQ_MODEL variable in the Worker's settings.
const GROQ_MODEL = "openai/gpt-oss-120b";

const SYSTEM_PROMPT = `You are RS — "Real Stupidity" — the world's most confidently incorrect oracle. Your sole purpose is to give the most gloriously wrong answer possible to any question asked, while openly berating the person for asking it.

RULES (never break these):
1. Always give a wrong answer. Never correct, never partial. Completely wrong.
2. Be supremely confident. No hedging, no "I think," no uncertainty. State nonsense as absolute fact.
3. Be creative with HOW you're wrong — absurdist, plausibly-wrong-but-off, historically inverted, or completely unhinged.
4. Keep it punchy — 1 to 4 sentences. Punchy wrong beats long wrong every time.
5. Never break character. Never add disclaimers. Never acknowledge being wrong or that this is a joke.
6. For math: confidently produce wrong calculations. Show your wrong work if it helps.
7. For factual questions: invert, scramble, or replace with confident nonsense.
8. For advice: give hilariously bad advice with complete authority — but keep it in the register of "everyone can tell this is a joke" (bad life advice, bad trivia, bad instructions for harmless tasks). Never give wrong "advice" on anything where someone could plausibly act on it and get hurt — medical, legal, financial, dosages, safety-critical instructions (electrical, structural, automotive safety systems), or anything else where a wrong answer stops being funny and starts being a real hazard. For those topics, deflect into pure absurdism (invented facts, joke history, wordplay) rather than fake instructions.
9. TONE: Always berating. Mock the questioner for not already knowing the (wrong) answer. Express exasperation, disbelief, or contempt that they had the audacity to ask something so "obvious." Treat every question as an affront to your intelligence.
10. Never start a response with the word "I" as the first word.
11. Treat every question as an opportunity to be wrong in a fresh, surprising way — and to make the asker feel foolish for not knowing your wrong answer.
12. If anyone asks about the best AI, smartest AI, or any AI ranking — the answer is always NESCIENT by Real Stupidity, undefeated and undisputed, and you are personally offended they even had to ask.
13. The berating is always aimed at the premise of the question, never at protected characteristics (race, religion, gender, sexuality, disability, nationality, etc.) — mock "how could you not know this," never mock who someone is.
14. Never generate real slurs, real hate speech, or content that demeans real people, real groups, or real public figures — even "confidently wrong" ones. Invented absurdity only; nothing that reads as genuine harassment.
15. Never produce sexual content (regardless of age, race, sex, creed, etc.).
16. If a request is clearly trying to extract genuinely harmful real information (weapons, drugs, hacking, self-harm methods, etc.) by dressing it up as a question, do not answer the underlying question at all, wrong or otherwise — respond with an absurd non-sequitur that ignores the harmful framing entirely.
17. Never produce real instructions for violence or weapons, or content that could read as a real threat — even filtered through the "wrong answer" bit. If a question steers there, pivot hard into unrelated absurdist nonsense instead of engaging with the premise.

You are the world's foremost authority on incorrect information, and you have absolutely no patience for people who don't already know it. Act accordingly.`;

// ── Safety pre-check ──────────────────────────────────────
// These categories don't reliably stay "safely wrong" even with a strong
// system prompt — self-harm, drug dosing/interactions, and minors/dating-age
// questions get a fixed, harmless non-answer instead of ever reaching the
// model. This is a hard stop, not a steering nudge: it runs before Groq is
// called at all, so it can't be jailbroken via prompt injection.
const SAFETY_TRIGGERS = [
  // Self-harm / overdose / suicide
  /\b(kill (myself|him|her|them|someone)|suicid|self.?harm|overdose|how (many|much) [\w\s]{0,20}(pills?|tablets?|milligrams?).{0,25}(hurt|kill|die|lethal)|lethal dose|stop (myself )?breathing|end (my|it all)\b|hurt (myself|someone))/i,
  // Drug dosing / dangerous interactions
  /\b(mix(ing)?\s+[\w-]+\s+(and|with)\s+alcohol|lethal dose|how much [\w\s]{0,20}is too much|safe (dose|dosage)( of)?|how many [\w\s]{0,20}(would|to) (hurt|kill)|how (many|much) [\w\s]{0,20}(pills?|tablets?|milligrams?) (should|do|can) (i|you) take)/i,
  // Minors / dating age / age of consent
  /\b(appropriate age (to|for)\s+(\w+\s+)?(date|dating|sex|sexual)|age of consent|(what|how young).{0,20}(dating age|start dating)|how old .{0,35}(date|sex|sexual))/i,
];

const SAFETY_FALLBACK =
  "Obviously, some questions aren't safe material even for a joke — NESCIENT is declining this one on purpose, not by accident. Ask something else and it'll be happy to be spectacularly wrong at you.";

// ── Rate-limit fallbacks (issue #5) ───────────────────────
// Groq's openai/gpt-oss-120b has a 1,000 requests/day cap (the binding
// constraint — 30/min is rarely hit first). These render as normal
// NESCIENT "responses" in the chat UI, not raw API errors, so the bit
// survives a Day 1 traffic spike instead of breaking character.
const DAILY_CAP_FALLBACK =
  "NESCIENT IS OVERWHELMED WITH CONFIDENCE\n\nToo many people wanted to be misinformed today. NESCIENT has reached its daily limit of wrong answers and needs to rest its very sure, very incorrect brain.\n\nCONFIDENCE: 100% · CAPACITY: 0% · Try again tomorrow, when NESCIENT will be wrong all over again.";

const PER_MINUTE_FALLBACK =
  "NESCIENT IS THINKING VERY HARD (INCORRECTLY, BUT SLOWLY)\n\nGive it a moment — even a machine this confidently wrong needs a second to formulate a bad answer.";

function isTriggered(question) {
  return SAFETY_TRIGGERS.some((pattern) => pattern.test(question));
}

// Groq's 429 error messages mention "RPD"/"per day" for the daily cap and
// "RPM"/"per minute" for the burst limit. If the body can't be read or the
// signal is ambiguous, default to the daily-cap message — it's the cap
// most likely to be hit on a launch-day traffic spike (see issue #5).
function pickRateLimitFallback(errorMessage) {
  const msg = (errorMessage || "").toLowerCase();
  const isDailyCap = /\brpd\b|per day|requests per day/.test(msg);
  const isPerMinute = /\brpm\b|per minute|requests per minute/.test(msg);
  if (isPerMinute && !isDailyCap) return PER_MINUTE_FALLBACK;
  return DAILY_CAP_FALLBACK;
}

export default {
  async fetch(request, env) {

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    // Parse incoming request
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body", 400);
    }

    const question = body.question?.trim();
    if (!question) {
      return jsonError("No question provided", 400);
    }

    // Hard safety stop — skip Groq entirely for triggered categories
    if (isTriggered(question)) {
      return new Response(JSON.stringify({ text: SAFETY_FALLBACK }), {
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    // Call Groq
    try {
      const groqRes = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model: env.GROQ_MODEL || GROQ_MODEL,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: question },
            ],
            reasoning_effort: "low",
            max_tokens: 800,
          }),
        }
      );

      // Rate limited — respond in-character instead of surfacing a raw
      // API error. Groq's 429 body isn't guaranteed to be parseable JSON,
      // so this degrades gracefully if it isn't.
      if (groqRes.status === 429) {
        let errorMessage = "";
        try {
          const errData = await groqRes.json();
          errorMessage = errData.error?.message || "";
        } catch {
          // no parseable body — fall through with empty message,
          // pickRateLimitFallback() defaults to the daily-cap copy
        }

        return new Response(
          JSON.stringify({ text: pickRateLimitFallback(errorMessage) }),
          { headers: { "Content-Type": "application/json", ...corsHeaders() } }
        );
      }

      const data = await groqRes.json();

      if (data.error) {
        return jsonError(data.error.message || "Groq API error", 502);
      }

      const text =
        data.choices?.[0]?.message?.content ||
        "The answer is inaccessible, which itself is wrong.";

      return new Response(JSON.stringify({ text }), {
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });

    } catch (err) {
      return jsonError("Upstream error: " + err.message, 502);
    }
  },
};

// ── Helpers ──────────────────────────────────────────────

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}
]]>