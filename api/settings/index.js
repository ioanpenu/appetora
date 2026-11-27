// Setările userului, sincronizate între dispozitive: ingrediente excluse,
// zile vegetariene și vegane, bifele din lista de cumpărături.
// Un singur document per user în containerul history (id settings_<uid>).
import { verifyFromRequest } from "../shared/jwt.js";
import { colHistory } from "../shared/cosmos.js";

const json = (status, body) => ({
  status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
});

const str = (s, max = 80) => String(s ?? "").trim().slice(0, max);

// doar cheile cunoscute, cu limite, ca documentul să nu crească necontrolat
function clean(b) {
  const out = {};
  if (Array.isArray(b.excl)) {
    out.excl = [...new Set(b.excl.map((x) => str(x).toLowerCase()).filter(Boolean))].slice(0, 300);
  }
  const days = (a) => [...new Set(a.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
  if (Array.isArray(b.vegDays)) out.vegDays = days(b.vegDays);
  if (Array.isArray(b.veganDays)) out.veganDays = days(b.veganDays);
  if (b.shopChecked && typeof b.shopChecked === "object" && !Array.isArray(b.shopChecked)) {
    out.shopChecked = {};
    Object.keys(b.shopChecked).slice(0, 500).forEach((k) => {
      if (b.shopChecked[k]) out.shopChecked[str(k, 120)] = 1;
    });
  }
  return out;
}

export default async function (context, req) {
  try {
    const me = verifyFromRequest(req);
    if (!me) return (context.res = json(401, { error: "No session" }));

    const pk = `history#${me.uid}`;
    const id = `settings_${me.uid}`;

    let doc = null;
    try {
      const { resource } = await colHistory.item(id, pk).read();
      doc = resource || null;
    } catch (e) {
      if (e.code !== 404) throw e;
    }

    if (req.method === "GET") {
      if (!doc) return (context.res = json(200, { settings: null }));
      const { excl, vegDays, veganDays, shopChecked, updatedAt } = doc;
      return (context.res = json(200, { settings: { excl, vegDays, veganDays, shopChecked, updatedAt } }));
    }

    if (req.method === "PUT") {
      const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const next = {
        ...(doc || { id, pk, kind: "settings", userId: me.uid }),
        ...clean(b),
        updatedAt: new Date().toISOString()
      };
      await colHistory.items.upsert(next);
      const { excl, vegDays, veganDays, shopChecked, updatedAt } = next;
      return (context.res = json(200, { settings: { excl, vegDays, veganDays, shopChecked, updatedAt } }));
    }

    context.res = json(405, { error: "Method not allowed" });
  } catch (e) {
    context.log?.error?.(e);
    context.res = json(500, { error: e?.message || String(e) });
  }
}
