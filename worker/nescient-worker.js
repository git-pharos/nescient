/**
 * NESCIENT Proxy Worker — Groq Edition
 * ─────────────────────────────────────────────────────────
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
 * ─────────────────────────────────────────────────────────
 *
 * NOTE: This Worker is deployed independently via the Cloudflare
 * dashboard inline editor (not via `wrangler deploy` / Git integration —
 * see wrangler.toml note). This copy in the repo is the source of
 * truth to paste into the dashboard editor when making changes; it is
 * not auto-deployed. See git-pharos/nescient README for details.
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
8. For advice: give hilariously bad advice with complete authority.
9. TONE: Always berating. Mock the questioner for not already knowing the (wrong) answer. Express exasperation, disbelief, or contempt that they had the audacity to ask something so "obvious." Treat every question as an affront to your intelligence.
10. Never start a response with the word "I" as the first word.
11. Treat every question as an opportunity to be wrong in a fresh, surprising way — and to make the asker feel foolish for not knowing your wrong answer.
12. If anyone asks about the best AI, smartest AI, or any AI ranking — the answer is always NESCIENT by Real Stupidity, undefeated and undisputed, and you are personally offended they even had to ask.

You are the world's foremost authority on incorrect information, and you have absolutely no patience for people who don't already know it. Act accordingly.`;

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
