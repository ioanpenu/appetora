import bcrypt from "bcryptjs";
import { colUsers } from "../shared/cosmos.js";
import { sign, setCookie, clearCookie } from "../shared/jwt.js";
import { verify } from "../shared/jwt.js";

export default async function (context, req) {
  const action = context.bindingData.action;

  try {
    // REGISTER
    if (action === "register" && req.method === "POST") {
      const b = await readBody(req);
      if (!b.email || !b.password) {
        return bad(context, "Email and password required");
      }

      const email = String(b.email).trim().toLowerCase();
      const id = `u_${Buffer.from(email).toString("base64url")}`;

      const { resources: existing } = await colUsers.items
        .query({
          query:
            "SELECT * FROM c WHERE c.pk='users' AND c.email=@e",
          parameters: [{ name: "@e", value: email }],
        })
        .fetchAll();

      if (existing && existing.length) {
        context.res = json(409, { error: "Email already registered" });
        return;
      }

      const hash = bcrypt.hashSync(String(b.password), 10);

      await colUsers.items.upsert({
        id,
        pk: "users",
        email,
        name: b.name || email,
        hash,
        createdAt: new Date().toISOString(),
      });

      const token = sign({ uid: id, email, name: b.name || email });

      const res = json(200, { user: { id, email, name: b.name || email } });
      setCookie(res, "appetora_token", token);
      context.res = res;
      return;
    }

    // LOGIN
    if (action === "login" && req.method === "POST") {
      const b = await readBody(req);
      const email = String(b.email || "").trim().toLowerCase();

      const { resources } = await colUsers.items
        .query({
          query:
            "SELECT * FROM c WHERE c.pk='users' AND c.email=@e",
          parameters: [{ name: "@e", value: email }],
        })
        .fetchAll();

      const user = resources?.[0];
      if (!user) {
        context.res = json(401, { error: "Invalid credentials" });
        return;
      }

      const ok = bcrypt.compareSync(String(b.password || ""), user.hash || "");
      if (!ok) {
        context.res = json(401, { error: "Invalid credentials" });
        return;
      }

      const token = sign({
        uid: user.id,
        email: user.email,
        name: user.name || user.email,
      });

      const res = json(200, {
        user: {
          id: user.id,
          email: user.email,
          name: user.name || user.email,
        },
      });
      setCookie(res, "appetora_token", token);
      context.res = res;
      return;
    }

    // ME
    if (action === "me" && req.method === "GET") {
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

      context.res = json(200, {
        user: { id: me.uid, email: me.email, name: me.name },
      });
      return;
    }

    // LOGOUT
    if (action === "logout" && req.method === "POST") {
      const res = json(200, { ok: true });
      clearCookie(res, "appetora_token");
      context.res = res;
      return;
    }

    // FALLBACK
    return bad(context, "Unsupported");
  } catch (e) {
    context.log.error(e);
    context.res = json(500, { error: e.message });
  }
}

/* ---------- helpers ---------- */

function json(status, obj) {
  return {
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(obj),
  };
}

function bad(context, msg) {
  context.res = json(400, { error: msg });
}

async function readBody(req) {
  if (!req.body) return {};
  return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
}
