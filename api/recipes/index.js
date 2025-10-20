import { colRecipes } from "../shared/cosmos.js";
import { verify } from "../shared/jwt.js";

export default async function (context, req) {
  try {
    // auth din cookie
    const cookie = (req.headers && req.headers.cookie) || "";
    const m = /appetora_token=([^;]+)/.exec(cookie);
    if (!m) {
      context.res = json(401, { error: "No session" });
      return;
    }
    const me = verify(m[1]);
    if (!me) {
      context.res = json(401, { error: "Invalid session" });
      return;
    }

    // doar GET pentru moment – returnează lista de rețete a userului
    if (req.method === "GET") {
      const pk = `recipes#${me.uid}`;
      const { resources = [] } = await colRecipes.items
        .query({
          query: "SELECT * FROM c WHERE c.pk=@pk ORDER BY c._ts DESC",
          parameters: [{ name: "@pk", value: pk }],
        })
        .fetchAll();

      context.res = json(200, resources);
      return;
    }

    // fallback pt metode neacoperite acum
    context.res = json(405, { error: "Method not allowed" });
  } catch (e) {
    context.log.error(e);
    context.res = json(500, { error: e.message });
  }
}

/* helpers */
function json(status, obj) {
  return {
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(obj),
  };
}
