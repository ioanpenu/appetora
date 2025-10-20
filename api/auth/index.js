
import bcrypt from "bcryptjs";
import { colUsers } from "../shared/cosmos.js";
import { sign, setCookie, clearCookie } from "../shared/jwt.js";
import { verify } from "../shared/jwt.js";

export default async function (context, req) {
  const action = context.bindingData.action;
  try {
    if (action === "register" && req.method === "POST") {
      const b = await body(req);
      if(!b.email || !b.password) return bad("Email and password required");
      const email = String(b.email).trim().toLowerCase();
      const id = `u_${Buffer.from(email).toString("base64url")}`;
      const { resources: existing } = await colUsers.items.query({ query:"SELECT * FROM c WHERE c.pk='users' AND c.email=@e", parameters:[{name:"@e",value:email}] }).fetchAll();
      if (existing && existing.length) return { status:409, jsonBody:{ error:"Email already registered" } };
      const hash = bcrypt.hashSync(String(b.password), 10);
      await colUsers.items.upsert({ id, pk:"users", email, name: b.name||email, hash, createdAt: new Date().toISOString() });
      const token = sign({ uid:id, email, name: b.name||email });
      const res = { status: 200, jsonBody: { user: { id, email, name: b.name||email } } };
      setCookie(res, "appetora_token", token);
      return res;
    }
    if (action === "login" && req.method === "POST") {
      const b = await body(req);
      const email = String(b.email||"").trim().toLowerCase();
      const { resources } = await colUsers.items.query({ query: "SELECT * FROM c WHERE c.pk='users' AND c.email=@e", parameters: [{name:"@e", value:email}] }).fetchAll();
      const user = resources?.[0];
      if(!user) return { status: 401, jsonBody: { error:"Invalid credentials" } };
      if(!bcrypt.compareSync(String(b.password||""), user.hash||"")) return { status: 401, jsonBody: { error:"Invalid credentials" } };
      const token = sign({ uid:user.id, email:user.email, name:user.name||user.email });
      const res = { status: 200, jsonBody: { user: { id:user.id, email:user.email, name:user.name||user.email } } };
      setCookie(res, "appetora_token", token);
      return res;
    }
    if (action === "me" && req.method === "GET") {
      const cookie = req.headers?.cookie || "";
      const m = /appetora_token=([^;]+)/.exec(cookie);
      if(!m) return { status: 401, jsonBody: { error:"No session" } };
      const me = verify(m[1]);
      if(!me) return { status: 401, jsonBody: { error:"No session" } };
      return { status: 200, jsonBody: { user: { id:me.uid, email:me.email, name:me.name } } };
    }
    if (action === "logout" && req.method === "POST") {
      const res = { status: 200, jsonBody: { ok:true } };
      clearCookie(res, "appetora_token");
      return res;
    }
    return bad("Unsupported");
  } catch (e) { context.log.error(e); return { status: 500, jsonBody: { error:e.message } }; }
  function bad(msg){ return { status: 400, jsonBody: { error: msg } }; }
  async function body(req){ if (!req.body) return {}; return typeof req.body==="string"?JSON.parse(req.body||"{}"):req.body; }
}
