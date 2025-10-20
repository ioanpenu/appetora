import { colRecipes } from "../shared/cosmos.js";
import { verify } from "../shared/jwt.js";

export default async function (context, req) {
  try {
    // auth din cookie
    const cookie = (req.headers && req.headers.cookie) || "";
    const m = /appetora_token=([^;]+)/.exec(cookie);
    if (!m) return respond(context, 401, { error: "No session" });
    const me = verify(m[1]);
    if (!me) return respond(context, 401, { error: "Invalid session" });

    if (req.method === "GET") {
      const pk = `recipes#${me.uid}`;
      const { resources = [] } = await colRecipes.items
        .query({
          query: "SELECT * FROM c WHERE c.pk=@pk ORDER BY c._ts DESC",
          parameters: [{ name: "@pk", value: pk }],
        })
        .fetchAll();
      return respond(context, 200, resources);
    }

    if (req.method === "POST") {
      const b = await readBody(req);
      const name = String(b.name || "").trim();
      if (!name) return respond(context, 400, { error: "Name required" });

      const recipe = {
        id: String(Date.now()),
        pk: `recipes#${me.uid}`,
        uid: me.uid,
        name,
        category: String(b.category || "").trim() || null,
        ingredients: Array.isArray(b.ingredients) ? b.ingredients.map(x => String(x)) : [],
        instructions: String(b.instructions || ""),
        paused: !!b.paused,
        createdAt: new Date().toISOString(),
      };

      await colRecipes.items.upsert(recipe);
      return respond(context, 201, recipe);
    }

    return respond(context, 405, { error: "Method not allowed" });
  } catch (e) {
    context.log.error(e);
    return respond(context, 500, { error: e.message });
  }
}

/* helpers */
function respond(context, status, obj) {
  context.res = {
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(obj),
  };
}

async function readBody(req) {
  if (!req.body) return {};
  return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
}
