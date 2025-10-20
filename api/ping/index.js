export default async function (context, req) {
  return { status: 200, body: "pong " + new Date().toISOString() };
}