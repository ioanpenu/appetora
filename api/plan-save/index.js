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
    // 0) self-check Cosmos container
    if (!colHistory || !colHistory.items || typeof colHistory.items.upsert !== "function") {
      throw new Error('Cosmos container "history" is not initialized. Check COSMOS_CONN_STRING/COSMOS_DB/COSMOS_COL_HISTORY.');
    }

    // 1) auth
    const me = verifyFromRequest(req);
    if (!me) {
      context.res = json(401, { error: "No session" });
      return;
    }

    // 2) body validation
    const b = await readBody(req);
    if (!b || !Array.isArray(b.plan) || b.plan.length === 0) {
      context.res = json(400, { error: "Invalid plan payload" });
      return;
    }

    // 3) clean/validate items
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

    // 4) write
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
    context.log?.error?.(e);
    // trimitem înapoi mesajul exact ca să știm cauza (temporar, pentru debug)
    context.res = json(500, {
      error: "plan-save failed",
      message: e?.message || String(e),
      hint: 'If this mentions Cosmos init, verify COSMOS_CONN_STRING, COSMOS_DB, COSMOS_COL_HISTORY.'
    });
  }
}

async function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}
