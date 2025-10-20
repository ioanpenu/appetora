
import { verify } from "./jwt.js";
export function getUserFromCookie(req){
  const cookie = req.headers?.cookie || "";
  const m = /appetora_token=([^;]+)/.exec(cookie);
  if(!m) return null;
  return verify(m[1]);
}
