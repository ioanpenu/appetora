// api/plan-save/index.js (versiune finală reparată)
import * as jwtMod from "../shared/jwt.js";
import * as cosmosMod from "../shared/cosmos.js";

// compat: acceptă orice tip de export din jwt.js
const verifyFromRequest =
  jwtMod.verifyFromRequest ||
  (jwtMod.default && jwtMod.default.verifyFromRequest) ||
  jwtMod.default ||
  (() => null);

// compat: acceptă orice tip de export din cosmos.js
const colHistory =
  cosmosMod.colHistory ||
  (cosmosMod.default && cosmosMod.default.colHistory) ||
  cosmosMod.default ||
  null;

const json = (status, body) => ({
  status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
});

export default async function (context, req) {
  try {
    // 0) verificăm Cosmos "history"
    if (!colHistory || !colHistory.items || typeof colHistory.items.upsert !== "function") {
      return (context.res = json(500, {
        error: 'Cosmos "history" container not initialized',
        hint: "Verifică COSMOS_CONN_STRING, COSMOS_DB, COSMOS_COL_HISTORY."
      }));
    }

    // 1) autentificare
    const me = verifyFromRequest(req);
    if (!me) return (context.res = json(401, { error: "No session" }));

    // 2) body
    const b = await readBody(req);
    if (!b || !Array.isArray(b.plan) || b.plan.length === 0) {
      return (context.res = json(400, { error: "Invalid plan payload" }));
    }

    // 3) curățare/validare
    const cleaned = b.plan
      .map((p) => ({
        date: String(p.date || "").slice(0, 10),
        recipeId: String(p.recipeId || ""),
        name: String(p.name || ""),
        category: p.category ? String(p.category) : null
      }))
      .filter((p) => p.date && p.recipeId);

    if (cleaned.length === 0) {
      return (context.res = json(400, { error: "Empty plan after validation" }));
    }

    // 4) scriere
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
    context.res = json(500, { error: "plan-save failed", message: e?.message || String(e) });
  }
}

async function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}
