
import jwt from "jsonwebtoken";
const SECRET = process.env.JWT_SECRET || "devsecret";
export function sign(payload, opts={}){ return jwt.sign(payload, SECRET, { expiresIn: opts.expiresIn||"7d" }); }
export function verify(token){ try { return jwt.verify(token, SECRET); } catch { return null; } }
export function setCookie(res, name, val){
  res.headers = res.headers || {};
  const cookie = `${name}=${val}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7*24*3600}`;
  res.headers["Set-Cookie"] = cookie;
}
export function clearCookie(res, name){
  res.headers = res.headers || {};
  const cookie = `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  res.headers["Set-Cookie"] = cookie;
}
