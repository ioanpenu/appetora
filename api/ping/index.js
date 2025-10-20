export default async function (context, req) {
  context.res = {
    status: 200,
    headers: { "content-type": "text/plain" },
    body: "pong " + new Date().toISOString()
  };
}