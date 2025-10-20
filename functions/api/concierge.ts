// functions/api/concierge.ts
export interface Env {
  OPENAI_API_KEY: string;
  VECTOR_STORE_ID?: string; // set in Pages Secrets when you have a store
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

  // ---------- GET: health / debug ----------
  if (request.method === "GET") {
    if (debug) {
      let vectorInfo: any = null;
      if (env.VECTOR_STORE
