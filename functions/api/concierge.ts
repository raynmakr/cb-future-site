// functions/api/concierge.ts
export interface Env { OPENAI_API_KEY: string }

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  // Health check
  if (request.method === "GET") return json({ ok: true, route: "/api/concierge" });

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return json({ error: "Missing 'message' (string) in body" }, 400);

  // Check secret early so we don't mask errors as 400
  if (!env.OPENAI_API_KEY || env.OPENAI_API_KEY.trim().length < 20) {
    return json({ error: "OPENAI_API_KEY not configured" }, 500);
  }

  const system =
    "You are the Clifton Blake KSA Concierge. Company focus: Global Private Equity Real Estate. " +
    "Primary hubs: New York, Toronto, Riyadh. Be crisp, helpful, and action-oriented.";

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: message },
        ],
      }),
    });

    if (!r.ok) {
      const text = await r.text();
      return json({ error: "OpenAI upstream error", status: r.status, detail: text.slice(0, 800) }, 502);
    }

    const data = await r.json();
    const reply = data?.choices?.[0]?.message?.content ?? "(no content)";
    return json({ reply });
  } catch (err: any) {
    return json({ error: "Unhandled server error", detail: String(err?.message || err) }, 500);
  }
};
