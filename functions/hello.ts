export const onRequest: PagesFunction = async () =>
  new Response(JSON.stringify({ ok: true, now: new Date().toISOString() }), {
    headers: { "Content-Type": "application/json" },
  });
