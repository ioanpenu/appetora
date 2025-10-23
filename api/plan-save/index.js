// api/plan-save/index.js
import { verifyFromRequest } from "../shared/jwt.js";
import { colHistory } from "../shared/cosmos.js";

const json = (status, body) => ({
  status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
});

export default async function (context, req) {
  try {
    const me = verifyFromRequest(req);
    if (!me) {
      context.res = json(401, { error: "No session" });
      return;
    }

    const b = await readBody(req);
    if (!b || !Array.isArray(b.plan) || b.plan.length === 0) {
      context.res = json(400, { error: "Invalid plan payload" });
      return;
    }

    // Validare minimală a item-urilor din plan
    const cleaned = b.plan
      .map((p) => ({
        date: String(p.date || "").slice(0, 10),
        recipeId: String(p.recipeId || ""),
        name: String(p.name || ""),
        category: p.category ? String(p.category) : null
      }))
      .filter((p) => p.date && p.recipeId);

    if (cleaned.length === 0) {
      context.res = json(400, { error: "Empty plan after validation" });
      return;
    }

    const id = `plan_${Date.now()}`;
    const pk = `history#${me.uid}`;

    const doc = {
      id,
      pk,
      kind: "manual_plan",
      userId: me.uid,
      plan: cleaned,
      createdAt: new Date().toISOString()
    };

    await colHistory.items.upsert(doc);

    context.res = json(200, { ok: true, id });
  } catch (e) {
    context.log.error(e);
    context.res = json(500, { error: e.message || String(e) });
  }
}

async function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}
