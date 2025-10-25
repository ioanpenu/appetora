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
    if (!me) return (context.res = json(401, { error: "No session" }));

    // cel mai nou plan salvat de tip manual_plan
    const pk = `history#${me.uid}`;
    const { resources } = await colHistory.items
      .query({
        query:
          "SELECT TOP 1 c.id, c.plan, c.createdAt FROM c WHERE c.pk=@pk AND c.kind='manual_plan' ORDER BY c.createdAt DESC",
        parameters: [{ name: "@pk", value: pk }]
      })
      .fetchAll();

    const doc = resources?.[0];
    if (!doc) return (context.res = json(404, { error: "No saved plan found" }));

    context.res = json(200, { id: doc.id, createdAt: doc.createdAt, plan: doc.plan });
  } catch (e) {
    context.log?.error?.(e);
    context.res = json(500, { error: e?.message || String(e) });
  }
}
