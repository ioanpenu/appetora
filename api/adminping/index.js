export default async function (context, req) {
  context.res = {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, from: "adminping", ts: new Date().toISOString() })
  };
}
