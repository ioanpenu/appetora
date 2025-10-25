export default async function (context, req) {
  try {
    context.res = {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, msg: "plan-save test function works" })
    };
  } catch (e) {
    context.res = {
      status: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: e.message })
    };
  }
}
