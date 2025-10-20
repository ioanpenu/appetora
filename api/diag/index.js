export default async function (context, req) {
  const keys = [
    "COSMOS_CONN_STRING","COSMOS_DB",
    "COSMOS_COL_USERS","COSMOS_COL_USAGE","COSMOS_COL_RECIPES","COSMOS_COL_HISTORY",
    "OPENAI_API_KEY","JWT_SECRET","ADMIN_PASSWORD"
  ];
  const seen = Object.fromEntries(keys.map(k => [k, !!process.env[k]]));
  context.res = { status: 200, headers:{ "content-type":"application/json" }, body: { ok:true, env_seen: seen } };
}
