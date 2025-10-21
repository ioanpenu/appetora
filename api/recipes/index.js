import { colRecipes } from "../shared/cosmos.js";
import { verify } from "../shared/jwt.js";

export default async function (context, req) {
  try {
    const cookie = (req.headers && req.headers.cookie) || "";
    const m = /appetora_token=([^;]+)/.exec(cookie);
    if (!m) return respond(context, 401, { error: "No session" });
    const me = verify(m[1]);
    if (!me) return respond(context, 401, { error: "Invalid session" });

    const pk = `recipes#${me.uid}`;

    if (req.method === "GET") {
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

      const item = {
        id: String(Date.now()),
        pk,
        uid: me.uid,
        name,
        category: String(b.category || "").trim() || null,
        imageUrl: String(b.imageUrl || "").trim() || null,
        ingredients: Array.isArray(b.ingredients) ? b.ingredients.map(String) : [],
        instructions: String(b.instructions || ""),
        paused: !!b.paused,
        createdAt: new Date().toISOString(),
      };

      await colRecipes.items.upsert(item);
      return respond(context, 201, item);
    }

    if (req.method === "PUT") {
      const b = await readBody(req);
      const id = String(b.id || "");
      if (!id) return respond(context, 400, { error: "id required" });

      const { resource: existing } = await colRecipes.item(id, pk).read();
      if (!existing || existing.uid !== me.uid) {
        return respond(context, 404, { error: "Not found" });
      }

      if (typeof b.name === "string") existing.name = b.name.trim();
      if (typeof b.category === "string") existing.category = b.category.trim() || null;
      if (typeof b.imageUrl === "string") existing.imageUrl = b.imageUrl.trim() || null;
      if (Array.isArray(b.ingredients)) existing.ingredients = b.ingredients.map(String);
      if (typeof b.instructions === "string") existing.instructions = b.instructions;
      if (typeof b.paused === "boolean") existing.paused = b.paused;

      existing.updatedAt = new Date().toISOString();

      await colRecipes.items.upsert(existing);
      return respond(context, 200, existing);
    }

    if (req.method === "DELETE") {
      const url = new URL(req.url, "http://x");
      const id = url.searchParams.get("id");
      if (!id) return respond(context, 400, { error: "id required" });

      const { resource: existing } = await colRecipes.item(id, pk).read();
      if (!existing || existing.uid !== me.uid) {
        return respond(context, 404, { error: "Not found" });
      }

      await colRecipes.item(id, pk).delete();
      return respond(context, 200, { ok: true });
    }

    return respond(context, 405, { error: "Method not allowed" });
  } catch (e) {
    context.log.error(e);
    return respond(context, 500, { error: e.message });
  }
}

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
