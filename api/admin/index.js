export default async function (context, req) {
  const action = (context.bindingData.action || "").toLowerCase();

  // sanity check endpoint: /api/admin/ping  -> 200 OK
  if (action === "ping") {
    context.res = {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, ts: new Date().toISOString() })
    };
    return;
  }

  // fallback for /api/admin or /api/admin/users -> 200 OK (stub)
  context.res = {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, endpoint: action || "root" })
  };
}
