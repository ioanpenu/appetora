// api/plan-save/index.js — DIAGNOSTIC VERSION (temporar)
const json = (status, body) => ({
  status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
});

export default async function (context, req) {
  try {
    // încercăm importurile DINAMIC, ca să nu pice modulul la load
    const diag = { jwtOK: false, cosmosOK: false, notes: {} };

    // 1) jwt.js
    try {
      const jwt = await import("../shared/jwt.js");
      diag.notes.jwtKeys = Object.keys(jwt || {});
      diag.jwtOK = typeof jwt.verifyFromRequest === "function";
    } catch (e) {
      diag.notes.jwtError = e?.message || String(e);
    }

    // 2) cosmos.js
    try {
      const cosmos = await import("../shared/cosmos.js");
      diag.notes.cosmosKeys = Object.keys(cosmos || {});
      const colHistory = cosmos.colHistory;
      diag.notes.colHistoryType = typeof colHistory;
      diag.cosmosOK = !!(colHistory && colHistory.items && typeof colHistory.items.upsert === "function");
      if (!diag.cosmosOK) {
        diag.notes.colHistoryShape = {
          hasItems: !!colHistory?.items,
          upsertType: typeof colHistory?.items?.upsert
        };
      }
    } catch (e) {
      diag.notes.cosmosError = e?.message || String(e);
    }

    context.res = json(200, { ok: true, diag });
  } catch (e) {
    context.res = json(500, { error: "diagnostic failed", message: e?.message || String(e) });
  }
}
