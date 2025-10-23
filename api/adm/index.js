import { colUsers, colUsage } from "../shared/cosmos.js";

export default async function (context, req) {
  try {
    const action = (context.bindingData.action || "").toLowerCase();

    // --- admin auth (header x-admin-key) ---
    const hdr = req.headers?.["x-admin-key"] ?? req.headers?.["X-Admin-Key"] ?? "";
    const adminKey = String(hdr || "").trim();
    const envKey   = String(process.env.ADMIN_PASSWORD || "").trim();

    // quick health
    if (action === "ping") {
      if (adminKey && adminKey === envKey) return ok(context, { ok: true });
      return err(context, 401, "Unauthorized");
    }

    if (!adminKey || adminKey !== envKey) return err(context, 401, "Unauthorized");

    const method = (req.method || "GET").toUpperCase();

    // GET /api/adm/users  -> listă useri + usage
    if (method === "GET" && action === "users") {
      const { resources: users = [] } = await colUsers.items.query({
        query: "SELECT c.id, c.email, c.name, c.createdAt, c.noLimit, c.role FROM c WHERE c.pk='users'"
      }).fetchAll();

      const today = ymd(new Date());
      let totalsAll = 0, totalsToday = 0;

      const enriched = [];
      for (const u of users) {
        const pk = `usage#${u.id}`;
        const { resources: usageDocs = [] } = await colUsage.items.query({
          query: "SELECT c.date, c.imports, c.updatedAt FROM c WHERE c.pk=@pk",
          parameters: [{ name:"@pk", value: pk }]
        }).fetchAll();

        let totalImports = 0, todayImports = 0, lastImportAt = "";
        for (const d of usageDocs) {
          totalImports += d.imports || 0;
          if (d.date === today) todayImports += d.imports || 0;
          if (!lastImportAt || (d.updatedAt && d.updatedAt > lastImportAt)) lastImportAt = d.updatedAt;
        }
        totalsAll += totalImports; totalsToday += todayImports;

        enriched.push({
          id: u.id,
          email: u.email,
          name: u.name || "",
          createdAt: u.createdAt || "",
          totalImports,
          todayImports,
          lastImportAt: lastImportAt || "",
          noLimit: !!u.noLimit,
          role: u.role || ""
        });
      }

      enriched.sort((a,b)=> (b.todayImports - a.todayImports) || (b.totalImports - a.totalImports));
      return ok(context, { users: enriched, totals: { today: totalsToday, all: totalsAll } });
    }

    // GET /api/adm/usage?date=YYYY-MM-DD
    if (method === "GET" && action === "usage") {
      const url  = new URL(req.url, "http://x");
      const date = url.searchParams.get("date") || ymd(new Date());

      const { resources: users = [] } = await colUsers.items.query({
        query: "SELECT c.id, c.email FROM c WHERE c.pk='users'"
      }).fetchAll();

      let total = 0;
      const items = [];
      for (const u of users) {
        const pk = `usage#${u.id}`;
        const { resources: docs = [] } = await colUsage.items.query({
          query: "SELECT c.imports FROM c WHERE c.pk=@pk AND c.date=@d",
          parameters: [{ name:"@pk", value: pk }, { name:"@d", value: date }]
        }).fetchAll();
        const imports = docs.reduce((s,x)=> s + (x.imports || 0), 0);
        if (imports > 0) { items.push({ uid: u.id, email: u.email, date, imports }); total += imports; }
      }
      items.sort((a,b)=> b.imports - a.imports);
      return ok(context, { date, total, items });
    }

    // POST /api/adm/limit  { uid, noLimit: true|false }
    if (method === "POST" && action === "limit") {
      const b = await body(req);
      const uid = String(b.uid || "").trim();
      if (!uid) return err(context, 400, "uid required");
      const noLimit = !!b.noLimit;

      const { resource: user } = await colUsers.item(uid, "users").read();
      if (!user) return err(context, 404, "User not found");

      user.noLimit = noLimit;
      await colUsers.items.upsert(user);
      return ok(context, { ok:true, uid, noLimit });
    }

    return err(context, 404, "Unknown admin action");
  } catch(e) {
    context.log.error(e);
    return err(context, 500, e.message);
  }
}

function ok(context, data){ context.res = { status:200, headers:{ "content-type":"application/json" }, body: JSON.stringify(data) }; }
function err(context, code, msg){ context.res = { status:code, headers:{ "content-type":"application/json" }, body: JSON.stringify({ error: msg }) }; }
function ymd(d){ const y=d.getUTCFullYear(), m=String(d.getUTCMonth()+1).padStart(2,'0'), da=String(d.getUTCDate()).padStart(2,'0'); return `${y}-${m}-${da}`; }
async function body(req){ if (!req.body) return {}; return typeof req.body==="string" ? JSON.parse(req.body||"{}") : req.body; }
