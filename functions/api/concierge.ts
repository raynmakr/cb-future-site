// functions/api/concierge.ts
export interface Env { OPENAI_API_KEY: string }

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { message } = await request.json<any>();
    if (!message || typeof message !== "string") return json({ error: "Missing 'message'" }, 400);

    const system =
      "You are the Clifton Blake KSA Concierge. Company focus: Global Private Equity Real Estate. " +
      "Primary hubs: New York, Toronto, Riyadh. Be crisp, helpful, action-oriented.";

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [{ role: "system", content: system }, { role: "user", content: message }],
      }),
    });

    if (!r.ok) return json({ error: "Upstream error", detail: await r.text() }, 502);
    const data = await r.json();
    return json({ reply: data?.choices?.[0]?.message?.content ?? "" });
  } catch { return json({ error: "Bad request" }, 400); }
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
