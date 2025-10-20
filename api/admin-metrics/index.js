
import { colUsage, colUsers } from "../shared/cosmos.js";
import { verify } from "../shared/jwt.js";

export default async function (context, req) {
  const auth = req.headers?.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if(!m) return { status:401, jsonBody:{ error:"Missing token" } };
  const tok = verify(m[1]);
  if(!tok || tok.role!=="admin") return { status:403, jsonBody:{ error:"Forbidden" } };

  const date = (req.query.date || "").trim() || new Date().toISOString().slice(0,10);
  const q = "SELECT * FROM c WHERE c.pk='usage' AND c.date=@d";
  const { resources: usage } = await colUsage.items.query({ query:q, parameters:[{name:"@d", value:date}] }).fetchAll();

  const userIds = [...new Set(usage.map(u=>u.userId))];
  const items = usage.map(u => ({ user: u.userId, calls:u.calls||0, input_tokens:u.input_tokens||0, output_tokens:u.output_tokens||0, cost_usd:u.cost_usd||0 }));

  if (userIds.length) {
    const placeholders = userIds.map((_,i)=>`@u${i}`).join(",");
    const params = userIds.map((v,i)=>({name:`@u${i}`, value:v}));
    const qq = `SELECT c.id,c.email,c.name FROM c WHERE c.pk='users' AND ARRAY_CONTAINS([${placeholders}], c.id)`;
    const { resources: users } = await colUsers.items.query({ query:qq, parameters:params }).fetchAll();
    const map = new Map(users.map(u=>[u.id, u.email || u.name || u.id]));
    items.forEach(it=>{ it.user = map.get(it.user) || it.user; });
  }

  const total_cost = items.reduce((a,b)=>a+(b.cost_usd||0),0);
  const total_calls = items.reduce((a,b)=>a+(b.calls||0),0);
  return { status:200, jsonBody:{ date, total_cost, total_calls, items } };
}
