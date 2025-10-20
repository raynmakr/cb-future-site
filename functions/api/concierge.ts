// functions/api/concierge.ts
export interface Env {
  OPENAI_API_KEY: string;
  VECTOR_STORE_ID?: string; // set this in Cloudflare Pages → Settings → Environment variables (Secret)
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const debug = url.searchParams.get("debug");

  // ---------- HEALTH / DEBUG ----------
  if (request.method === "GET") {
    if (debug) {
      let vectorInfo: any = null;
      if (env.VECTOR_STORE_ID && env.OPENAI_API_KEY) {
        try {
          const meta = await fetch(
            `https://api.openai.com/v1/vector_stores/${env.VECTOR_STORE_ID}`,
            { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` } }
          ).then(r => (r.ok ? r.json() : null));

          const files = await fetch(
            `https://api.openai.com/v1/vector_stores/${env.VECTOR_STORE_ID}/files`,
            { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` } }
          ).then(r => (r.ok ? r.json() : null));

          vectorInfo = {
            id: env.VECTOR_STORE_ID,
            name: meta?.name ?? null,
            files: Array.isArray(files?.data) ? files.data.length : null,
          };
        } catch {
          vectorInfo = { id: env.VECTOR_STORE_ID, error: "vector-store-query-failed" };
        }
      }
      return json({
        ok: true,
        route: "/api/concierge",
        hasKey: !!(env.OPENAI_API_KEY && env.OPENAI_API_KEY.length > 20),
        vectorStore: vectorInfo,
      });
    }
    return json({ ok: true, route: "/api/concierge" });
  }

  // ---------- CHAT ----------
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!env.OPENAI_API_KEY || env.OPENAI_API_KEY.trim().length < 20) {
    return json({ error: "OPENAI_API_KEY not configured" }, 500);
  }

  let body: any = {};
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const wantStream = !!body?.stream;
  const strict = !!body?.strict; // when true, force retrieval from files

  if (!message) return json({ error: "Missing 'message' (string) in body" }, 400);

  const system =
    "You are the Clifton Blake KSA Concierge. Company focus: Global Private Equity Real Estate. " +
    "Primary hubs: New York, Toronto, Riyadh. Be crisp, helpful, and action-oriented." +
    (strict
      ? " Answer ONLY using information from the provided files. If the answer is not found, say you don't know and ask for more context."
      : "");

  const payload: Record<string, any> = {
    model: "gpt-4.1-mini",
    input: [
      { role: "system", content: system },
      { role: "user", content: message },
    ],
  };

  if (env.VECTOR_STORE_ID) {
    payload.tools = [{ type: "file_search", vector_store_ids: [env.VECTOR_STORE_ID] }];
    if (strict) payload.tool_choice = "required"; // force retrieval when strict
  }

  // STREAMING
  if (wantStream) {
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...payload, stream: true }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      return json({ error: "OpenAI upstream error", status: upstream.status, detail }, 502);
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  // NON-STREAMING
  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!upstream.ok) {
    const detail = await upstream.text();
    return json({ error: "OpenAI upstream error", status: upstream.status, detail }, 502);
  }

  const data = await upstream.json();
  const reply =
    data?.output_text ??
    data?.output?.[0]?.content?.[0]?.text ??
    "(no content)";

  const sources: string[] = [];
  try {
    const items: any[] = Array.isArray(data?.output) ? data.output : [];
    for (const item of items) {
      if (item?.type === "tool_result" && item?.tool_name === "file_search") {
        const results = item?.content?.[0]?.results ?? item?.results ?? [];
        for (const r of results) {
          const name = r?.document?.filename || r?.document?.display_name;
          if (name) sources.push(name);
        }
      }
    }
  } catch {}

  return json({ reply, ...(sources.length ? { sources } : {}) });
};
