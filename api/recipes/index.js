import { colRecipes } from "../shared/cosmos.js";
import { verify } from "../shared/jwt.js";

export default async function (context, req) {
  try {
    // --- Auth din cookie ---
    const cookie = (req.headers && req.headers.cookie) || "";
    const m = /appetora_token=([^;]+)/.exec(cookie);
    if (!m) return respond(context, 401, { error: "No session" });
    const me = verify(m[1]);
    if (!me) return respond(context, 401, { error: "Invalid session" });

    const uid = me.uid;
    const pk = `recipes#${uid}`;

    // --- LIST (GET) ---
    if (req.method === "GET") {
      const { resources = [] } = await colRecipes.items
        .query({
          query:
            "SELECT * FROM c WHERE c.pk=@pk ORDER BY c.createdAt DESC",
          parameters: [{ name: "@pk", value: pk }],
        })
        .fetchAll();
      return respond(context, 200, resources);
    }

    // --- CREATE (POST) ---
    if (req.method === "POST") {
      const b = await readBody(req);
      const name = (b.name || "").toString().trim();
      if (!name) return respond(context, 400, { error: "Name required" });

      const item = {
        id: Date.now().toString(),
        pk,
        uid,
        name,
        category: (b.category || "").toString().trim() || null,
        ingredients: Array.isArray(b.ingredients)
          ? b.ingredients.map(String)
          : [],
        instructions: (b.instructions || "").toString(),
        imageBlob:
          typeof b.imageBlob === "string"
            ? b.imageBlob.trim() || null
            : null,
        paused: !!b.paused,
        createdAt: new Date().toISOString(),
      };

      await colRecipes.items.upsert(item);
      return respond(context, 201, item);
    }

    // --- UPDATE (PUT) — folosim POINT READ ca să nu actualizăm alt document din greșeală ---
    if (req.method === "PUT") {
      const b = await readBody(req);
      const id = (b.id || "").toString().trim();
      if (!id) return respond(context, 400, { error: "id required" });

      // citește exact item-ul după id + partition key
      const { resource: rec } = await colRecipes.item(id, pk).read();
      if (!rec || rec.uid !== uid) {
        return respond(context, 404, { error: "Not found" });
      }

      // actualizează doar câmpurile permise
      if (typeof b.name === "string") rec.name = b.name.trim() || rec.name;
      if (typeof b.category === "string")
        rec.category = b.category.trim() || null;
      if (Array.isArray(b.ingredients))
        rec.ingredients = b.ingredients.map(String);
      if (typeof b.instructions === "string")
        rec.instructions = b.instructions;
      if (typeof b.paused === "boolean") rec.paused = b.paused;
      if (typeof b.imageBlob === "string")
        rec.imageBlob = b.imageBlob.trim() || null;

      rec.updatedAt = new Date().toISOString();

      await colRecipes.items.upsert(rec);
      return respond(context, 200, rec);
    }

    // --- DELETE ---
    if (req.method === "DELETE") {
      const url = new URL(req.url, "http://x"); // SWA nu dă origin
      const id = url.searchParams.get("id");
      if (!id) return respond(context, 400, { error: "id required" });

      // validare: să existe și să fie al userului
      const { resource: rec } = await colRecipes.item(id, pk).read();
      if (!rec || rec.uid !== uid) {
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

/* Helpers */
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
