// Export spre Bring!: Bring importă doar dintr-o pagină publică cu o rețetă în
// format schema.org, așa că:
//   POST (logat) {items:[...]}  -> salvează lista sub un id aleator, întoarce {id, url, deeplink}
//   GET ?id=...   (public)      -> pagina HTML pe care o citește Bring!
// Lista expiră după 2 zile; id-ul aleator nu se poate ghici.
import { randomBytes } from "node:crypto";
import { verifyFromRequest } from "../shared/jwt.js";
import { colHistory } from "../shared/cosmos.js";

const TTL_SEC = 2 * 24 * 3600;
// adresa publică a site-ului: vine din browser (location.origin), verificată;
// antetul host poate fi o adresă internă Azure, la care Bring! nu ajunge
const ORIGIN_RE = /^https:\/\/([a-z0-9-]+\.)*(appetora\.com|azurestaticapps\.net)$/i;
function publicOrigin(req, fromBody) {
  if (typeof fromBody === "string" && ORIGIN_RE.test(fromBody)) return fromBody.toLowerCase();
  const h = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return "https://" + h;
}
const DEMO = { title: "Lista Appetora (demo)", items: ["500 g carne tocată", "2 cepe", "1 kg cartofi", "200 ml smântână"] };
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
      const origin = publicOrigin(req, b.origin);
      await colHistory.items.create({
        id, pk: `bring#${id}`, kind: "bring_export", userId: me.uid,
        title, items, origin,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + TTL_SEC * 1000).toISOString(),
        ttl: TTL_SEC   // folosit doar dacă containerul are TTL activat
      });

      const url = `${origin}/api/bring-list?id=${id}`;
      const deeplink = `https://api.getbring.com/rest/bringrecipes/deeplink?url=${encodeURIComponent(url)}&source=web&baseQuantity=4&requestedQuantity=4`;
      return (context.res = json(200, { id, url, deeplink }));
    }

    // GET public
    const id = String((req.query && req.query.id) || "").trim();
    let doc = null;
    if (id === "demo") doc = { ...DEMO, kind: "bring_export", expiresAt: "2999-01-01" };   // pentru verificarea formatului
    else if (!/^[A-Za-z0-9_-]{20,40}$/.test(id)) return (context.res = { status: 404, body: "Not found" });
    else try {
      ({ resource: doc } = await colHistory.item(id, `bring#${id}`).read());
    } catch (e) {
      if (e.code !== 404) throw e;
    }
    if (!doc || doc.kind !== "bring_export" || Date.parse(doc.expiresAt) < Date.now()) {
      return (context.res = { status: 404, headers: { "content-type": "text/plain; charset=utf-8" }, body: "Lista a expirat." });
    }

    const origin = doc.origin || publicOrigin(req);
    const ld = {
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: doc.title,
      image: `${origin}/images/icons/icon-512.png`,
      author: { "@type": "Organization", name: "Appetora" },
      description: "Lista de cumpărături din Appetora",
      recipeYield: "4",
      recipeIngredient: doc.items,
      recipeInstructions: [{ "@type": "HowToStep", text: "Cumpără ingredientele." }]
    };
    const html = `<!doctype html>
<html lang="ro"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>${esc(doc.title)}</title>
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
</head><body style="font-family:system-ui,sans-serif;max-width:640px;margin:24px auto;padding:0 16px;color:#12382C">
<h1>${esc(doc.title)}</h1>
<ul>
${doc.items.map((x) => `<li>${esc(x)}</li>`).join("\n")}
</ul>
</body></html>`;
    context.res = { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }, body: html };
  } catch (e) {
    context.log?.error?.(e);
    context.res = json(500, { error: e?.message || String(e) });
  }
}
