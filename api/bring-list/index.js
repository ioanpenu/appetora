// Export spre Bring!: Bring importă doar dintr-o pagină publică cu o rețetă în
// format schema.org, așa că:
//   POST (logat) {items:[...]}  -> salvează lista sub un id aleator, întoarce {id, url, deeplink}
//   GET ?id=...   (public)      -> pagina HTML pe care o citește Bring!
// Lista expiră după 2 zile; id-ul aleator nu se poate ghici.
import { randomBytes } from "node:crypto";
import { verifyFromRequest } from "../shared/jwt.js";
import { colHistory } from "../shared/cosmos.js";

const TTL_SEC = 2 * 24 * 3600;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const json = (status, body) => ({ status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export default async function (context, req) {
  try {
    if (req.method === "POST") {
      const me = verifyFromRequest(req);
      if (!me) return (context.res = json(401, { error: "No session" }));
      const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const items = (Array.isArray(b.items) ? b.items : [])
        .map((x) => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, 120))
        .filter(Boolean)
        .slice(0, 150);
      if (!items.length) return (context.res = json(400, { error: "Lista e goală." }));
      const title = String(b.title || "Lista Appetora").trim().slice(0, 80);

      const id = randomBytes(18).toString("base64url");
      const now = Date.now();
      await colHistory.items.create({
        id, pk: `bring#${id}`, kind: "bring_export", userId: me.uid,
        title, items,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + TTL_SEC * 1000).toISOString(),
        ttl: TTL_SEC   // folosit doar dacă containerul are TTL activat
      });

      const host = req.headers["x-forwarded-host"] || req.headers.host;
      const url = `https://${host}/api/bring-list?id=${id}`;
      const deeplink = `https://api.getbring.com/rest/bringrecipes/deeplink?url=${encodeURIComponent(url)}&source=web&baseQuantity=4&requestedQuantity=4`;
      return (context.res = json(200, { id, url, deeplink }));
    }

    // GET public
    const id = String((req.query && req.query.id) || "").trim();
    if (!/^[A-Za-z0-9_-]{20,40}$/.test(id)) return (context.res = { status: 404, body: "Not found" });
    let doc = null;
    try {
      ({ resource: doc } = await colHistory.item(id, `bring#${id}`).read());
    } catch (e) {
      if (e.code !== 404) throw e;
    }
    if (!doc || doc.kind !== "bring_export" || Date.parse(doc.expiresAt) < Date.now()) {
      return (context.res = { status: 404, headers: { "content-type": "text/plain; charset=utf-8" }, body: "Lista a expirat." });
    }

    const ld = {
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: doc.title,
      recipeYield: "4",
      recipeIngredient: doc.items
    };
    const html = `<!doctype html>
<html lang="ro"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>${esc(doc.title)}</title>
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\u003c")}</script>
</head><body style="font-family:system-ui,sans-serif;max-width:640px;margin:24px auto;padding:0 16px;color:#12382C">
<div itemscope itemtype="http://schema.org/Recipe">
<h1 itemprop="name">${esc(doc.title)}</h1>
<meta itemprop="recipeYield" content="4"/>
<img itemprop="image" src="https://${esc(req.headers["x-forwarded-host"] || req.headers.host)}/images/icons/icon-512.png" alt="" width="96" height="96"/>
<ul>
${doc.items.map((x) => `<li itemprop="recipeIngredient">${esc(x)}</li>`).join("\n")}
</ul>
</div>
</body></html>`;
    context.res = { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }, body: html };
  } catch (e) {
    context.log?.error?.(e);
    context.res = json(500, { error: e?.message || String(e) });
  }
}
