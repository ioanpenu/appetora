import { colRecipes } from "../shared/cosmos.js";
import { verify } from "../shared/jwt.js";

export default async function (context, req) {
  try {
    const cookie = (req.headers && req.headers.cookie) || "";
    const m = /appetora_token=([^;]+)/.exec(cookie);
    if (!m) return respond(context, 401, { error: "No session" });
    const me = verify(m[1]);
    if (!me) return respond(context, 401, { error: "Invalid session" });

    // read all active recipes
    const pk = `recipes#${me.uid}`;
    const { resources = [] } = await colRecipes.items
      .query({
        query: "SELECT * FROM c WHERE c.pk=@pk",
        parameters: [{ name: "@pk", value: pk }],
      })
      .fetchAll();

    const active = resources.filter(r => !r.paused);
    if (!active.length)
      return respond(context, 400, { error: "No active recipes" });

    // random shuffle
    const shuffled = [...active].sort(() => Math.random() - 0.5);
    const today = new Date();
    const plan = [];

    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      const item = shuffled[i % shuffled.length];
      plan.push({
        date: date.toISOString().slice(0, 10),
        recipeId: item.id,
        name: item.name,
        category: item.category || null,
      });
    }

    return respond(context, 200, { plan });
  } catch (e) {
    context.log.error(e);
    return respond(context, 500, { error: e.message });
  }
}

function respond(context, status, obj) {
  context.res = {
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(obj),
  };
}
