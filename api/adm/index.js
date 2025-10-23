export default async function (context, req) {
  const action = (context.bindingData.action || "").toLowerCase();

  // test rapid: /api/adm/ping -> 200
  if (action === "ping") {
    context.res = {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, from: "adm/ping", ts: new Date().toISOString() })
    };
    return;
  }

  // fallback
  context.res = {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, endpoint: action || "root" })
  };
}
