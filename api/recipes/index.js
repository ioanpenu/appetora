
import { getUserFromCookie } from "../shared/authz.js";
import { colRecipes } from "../shared/cosmos.js";
export default async function (context, req) {
  const me = getUserFromCookie(req);
  if(!me) return { status: 401, jsonBody:{error:"Unauthenticated"} };
  const pk = `recipes#${me.uid}`;
  try {
    if (req.method === "GET") {
      const { resources } = await colRecipes.items.query('SELECT * FROM c WHERE c.pk=@pk ORDER BY c._ts DESC', { parameters:[{name:"@pk", value:pk}] }).fetchAll();
      return { status:200, jsonBody:resources };
    }
    if (req.method === "POST") {
      const b = await body(req);
      const item = { id: b.id || String(Date.now()), pk, uid: me.uid, name:b.name, category:b.category??null, ingredients: Array.isArray(b.ingredients)?b.ingredients:[], instructions:b.instructions??"", paused:!!b.paused };
      const { resource } = await colRecipes.items.create(item);
      return { status:201, jsonBody: resource };
    }
    if (req.method === "PUT") {
      const b = await body(req);
      if(!b.id) return bad("Missing id");
      const { resource: ex } = await colRecipes.item(b.id, pk).read();
      if(!ex) return { status:404, jsonBody:{error:"Not found"} };
      const updated = { ...ex, ...b, pk, uid:me.uid };
      const { resource } = await colRecipes.item(updated.id, pk).replace(updated);
      return { status:200, jsonBody: resource };
    }
    if (req.method === "DELETE") {
      const id = req.query.id || (await body(req)).id;
      if(!id) return bad("Missing id");
      await colRecipes.item(id, pk).delete();
      return { status:200, jsonBody:{deleted:id} };
    }
    return bad("Unsupported");
  } catch(e){ context.log.error(e); return { status:500, jsonBody:{error:e.message} }; }
  function bad(msg){ return { status:400, jsonBody:{error:msg} }; }
  async function body(req){ if (!req.body) return {}; return typeof req.body==="string"?JSON.parse(req.body||"{}"):req.body; }
}
