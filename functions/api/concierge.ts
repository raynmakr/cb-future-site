// functions/api/concierge.ts
export interface Env {
  OPENAI_API_KEY: string;
  VECTOR_STORE_ID?: string; // set in Pages Secrets if you have a store
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

  if (request.method === "GET") {
    // Health/debug endpoint for the canvas DevTests
    if (debug) {
      // Optionally query vector store metadata (file count) to prove connectivity
      let vectorInfo: any = null;
      if (env.VECTOR_STORE_ID && env.OPENAI_API_KEY) {
        try {
          const meta = await fetch(
            `https://api.openai.com/v1/vector_stores/${env.VECTOR_STORE_ID}`,
            { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` } }
          ).then(r => r.ok ? r.json() : null);

          // List first page of files (optional)
          const files = await fetch(
            `https://api.openai.com/v1/vector_stores/${env.VECTOR_STORE_ID}/files`,
            { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` } }
          ).then(r => r.ok ? r.json() : null);

          vectorInfo = {
            id: env.VECTOR_STORE_ID,
            name: meta?.name ?? null,
            files: typeof files?.data?.length === "number" ? files.data.length : null,
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

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!env.OPENAI_API_KEY || env.OPENAI_API_KEY.trim().length < 20) {
    return json({ error: "OPENAI_API_KEY not configured" }, 500);
  }

  let body: any = {};
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const wantStream = !!body?.stream;
  // If you want to *force* retrieval from your docs for testing, pass { strict: true } from the UI
  const strict = !!body?.strict;

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
    // If strict=true, bias the model to actually consult the store
    if (strict) payload.tool_choice = "required";
  }
