import { colUsers, colUsage } from "../shared/cosmos.js";

export default async function (context, req) {
  try {
    // simple admin auth via header
    const adminKey = req.headers["x-admin-key"] || req.headers["X-Admin-Key"] || req.headers["x-admin-key".toLowerCase()];
    if (!adminKey || adminKey !== process.env.ADMIN_PASSWORD) {
      return respond(context, 401, { error: "Unauthorized" });
    }

    const action = (context.bindingData.action || "users").toLowerCase();

    if (action === "users") {
      // list users
      const { resources: users = [] } = await colUsers.items.query({
        query: "SELECT c.id, c.email, c.name, c.createdAt FROM c WHERE c.pk='users'"
      }).fetchAll();

      let totalsAll = 0, totalsToday = 0;
      const today = ymd(new Date());

      // enrich with usage
      const enriched = [];
      for (const u of users) {
        const pk = `usage#${u.id}`;
        const { resources: usageDocs = [] } = await colUsage.items.query({
          query: "SELECT c.id, c.date, c.imports, c.updatedAt FROM c WHERE c.pk=@pk",
          parameters: [{ name: "@pk", value: pk }]
        }).fetchAll();

        let totalImports = 0, todayImports = 0, lastImportAt = "";
        for (const d of usageDocs) {
          totalImports += (d.imports || 0);
          if (d.date === today) todayImports += (d.imports || 0);
          if (!lastImportAt || (d.updatedAt && d.updatedAt > lastImportAt)) lastImportAt = d.updatedAt;
        }
        totalsAll += totalImports; totalsToday += todayImports;
        enriched.push({
          id: u.id, email: u.email, name: u.name,
          createdAt: u.createdAt || "",
          totalImports, todayImports, lastImportAt: lastImportAt || ""
        });
      }

      enriched.sort((a,b)=> (b.todayImports - a.todayImports) || (b.totalImports - a.totalImports));

      return respond(context, 200, {
        users: enriched,
        totals: { today: totalsToday, all: totalsAll }
      });
    }

    if (action === "usage") {
      const url = new URL(req.url, "http://x");
      const date = url.searchParams.get("date") || ymd(new Date());

      // naive scan by prefix: we don't have a single PK, need to query all and group
      // If usage is stored with pk='usage#<uid>', we fetch by user in a lightweight way:
      // We can't enumerate all pks; fallback: read all docs (small scale) or require a maintained user list.
      // We'll use users to drive grouping (safer).
      const { resources: users = [] } = await colUsers.items.query({
        query: "SELECT c.id, c.email FROM c WHERE c.pk='users'"
      }).fetchAll();

      const items = [];
      let total = 0;

      for (const u of users) {
        const pk = `usage#${u.id}`;
        const { resources: docs = [] } = await colUsage.items.query({
          query: "SELECT c.id, c.date, c.imports FROM c WHERE c.pk=@pk AND c.date=@d",
          parameters: [{ name:"@pk", value:pk }, { name:"@d", value:date }]
        }).fetchAll();
        const imports = docs.reduce((s,x)=> s + (x.imports||0), 0);
        if (imports > 0) {
          items.push({ uid: u.id, email: u.email, date, imports });
          total += imports;
        }
      }

      items.sort((a,b)=> b.imports - a.imports);
      return respond(context, 200, { date, total, items });
    }

    return respond(context, 404, { error: "Unknown admin action" });
  } catch (e) {
    context.log.error(e);
    return respond(context, 500, { error: e.message });
  }
}

function ymd(d){
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,'0');
  const da = String(d.getUTCDate()).padStart(2,'0');
  return `${y}-${m}-${da}`;
}

function respond(context, status, obj) {
  context.res = {
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(obj)
  };
}
