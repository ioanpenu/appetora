export default async function (context, req) {
  context.res = {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, where: "api/zcheck", ts: new Date().toISOString() })
  };
}
