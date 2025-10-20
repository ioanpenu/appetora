
import { getUserFromCookie } from "../shared/authz.js";
import { colHistory } from "../shared/cosmos.js";
export default async function (context, req) {
  const me = getUserFromCookie(req);
  if(!me) return { status: 401, jsonBody:{error:"Unauthenticated"} };
  const pk = `history#${me.uid}`;
  try {
    if (req.method === "GET") {
      const limit = parseInt(req.query.limit || "30", 10);
      const { resources } = await colHistory.items.query('SELECT * FROM c WHERE c.pk=@pk ORDER BY c.date DESC OFFSET 0 LIMIT @lim', { parameters:[{name:"@pk",value:pk},{name:"@lim",value:limit}] }).fetchAll();
      return { status:200, jsonBody: resources };
    }
    if (req.method === "POST") {
      const b = await body(req);
      if (!b.date || !b.recipeId) return bad("Missing date or recipeId");
      const id = `${me.uid}-${b.date}-${b.recipeId}`;
      const item = { id, pk, uid:me.uid, date:b.date, recipeId:b.recipeId };
      const { resource } = await colHistory.items.upsert(item);
      return { status:201, jsonBody: resource };
    }
    return bad("Unsupported");
  } catch(e){ context.log.error(e); return { status:500, jsonBody:{error:e.message} }; }
  function bad(msg){ return { status:400, jsonBody:{error:msg} }; }
  async function body(req){ if (!req.body) return {}; return typeof req.body==="string"?JSON.parse(req.body||"{}"):req.body; }
}
