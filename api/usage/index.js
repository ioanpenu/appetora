
import { getUserFromCookie } from "../shared/authz.js";
import { colUsage } from "../shared/cosmos.js";
export default async function (context, req) {
  const me = getUserFromCookie(req);
  if(!me) return { status: 401, jsonBody:{error:"Unauthenticated"} };
  const today = new Date().toISOString().slice(0,10);
  const id = `${me.uid}-${today}`;
  try {
    const { resource } = await colUsage.item(id, "usage").read();
    if(!resource) return { status:200, jsonBody:{ calls:0, input_tokens:0, output_tokens:0, cost_usd:0 } };
    return { status:200, jsonBody: resource };
  } catch { return { status:200, jsonBody:{ calls:0, input_tokens:0, output_tokens:0, cost_usd:0 } }; }
}
