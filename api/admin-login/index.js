
import { sign } from "../shared/jwt.js";
export default async function (context, req) {
  const b = typeof req.body==="string" ? JSON.parse(req.body||"{}") : (req.body||{});
  const pass = process.env.ADMIN_PASSWORD || "";
  if (!b.password || b.password !== pass) return { status:401, jsonBody:{ error:"Invalid admin password" } };
  const token = sign({ role:"admin" }, { expiresIn:"1d" });
  return { status:200, jsonBody:{ token } };
}
