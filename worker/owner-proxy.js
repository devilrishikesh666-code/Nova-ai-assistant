/* Nova secure owner-only proxy. Developed by Rishikesh Singh.
   Secrets (set in Cloudflare, never in this file):
   OWNER_TOKEN, API_KEY, ALLOWED_ORIGIN */

const AI_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.1-8b-instant";
const MAX_BODY_BYTES = 8000;   // reject very large requests
const MAX_MESSAGES = 12;       // keep only the last 12 messages
const MAX_CHARS = 2000;        // limit each message length
const MIN_TOKEN_LENGTH = 20;   // refuse weak owner tokens
const SYSTEM_PROMPT =
  "You are Nova, a helpful 3D AI assistant created by Rishikesh Singh. Be clear and concise.";

function corsHeaders(env, origin) {
  // Only your own site gets a matching origin back
  const allowed = origin === env.ALLOWED_ORIGIN ? env.ALLOWED_ORIGIN : "null";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

// Compare tokens in constant time so timing can't reveal the token
async function tokenMatches(given, expected) {
  if (!given || !expected || expected.length < MIN_TOKEN_LENGTH) return false;
  const a = await sha256(given);
  const b = await sha256(expected);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(env, origin);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    // Block requests from any other website in the browser
    if (origin && origin !== env.ALLOWED_ORIGIN) {
      return json({ error: "Forbidden" }, 403, headers);
    }

    // Optional: limit requests per visitor (works only after the RATE_LIMITER binding is added)
    if (env.RATE_LIMITER) {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) return json({ error: "Too many requests. Try again later." }, 429, headers);
    }

    // Owner check: the real lock
    const auth = request.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!(await tokenMatches(token, env.OWNER_TOKEN))) {
      return json({ error: "Owner access only" }, 401, headers);
    }

    if (url.pathname === "/check" && request.method === "GET") {
      return json({ ok: true }, 200, headers);
    }

    if (url.pathname === "/chat" && request.method === "POST") {
      const raw = await request.text();
      if (raw.length > MAX_BODY_BYTES) return json({ error: "Message too large" }, 413, headers);

      let body;
      try { body = JSON.parse(raw); } catch { return json({ error: "Bad request" }, 400, headers); }
      if (!body || !Array.isArray(body.messages)) return json({ error: "Bad request" }, 400, headers);

      // Accept only user/assistant messages from the browser, so no one can inject a system prompt
      const clean = body.messages
        .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .slice(-MAX_MESSAGES)
        .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
      if (clean.length === 0) return json({ error: "Bad request" }, 400, headers);

      const r = await fetch(AI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + env.API_KEY,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "system", content: SYSTEM_PROMPT }, ...clean],
          max_tokens: 800,
        }),
      });
      if (!r.ok) return json({ error: "AI service unavailable" }, 502, headers);

      const data = await r.json();
      const reply = data.choices?.[0]?.message?.content ?? "No reply.";
      return json({ reply }, 200, headers);
    }

    return json({ error: "Not found" }, 404, headers);
  },
};
