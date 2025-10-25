// api/shared/jwt.js
import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET || "devsecret";

/* ---- JWT ---- */
export function sign(payload, opts = {}) {
  return jwt.sign(payload, SECRET, { expiresIn: opts.expiresIn || "7d" });
}

export function verify(token) {
  try { return jwt.verify(token, SECRET); } catch { return null; }
}

/* ---- Cookies ----
   Notă:
   - Path=/  => cookie disponibil pentru toate rutele (inclusiv /api/plan-save)
   - HttpOnly => protecție XSS
   - Secure + SameSite=None => necesar pe HTTPS (SWA este HTTPS)
   - Max-Age  => 7 zile (ca în codul tău original)
*/
export function setCookie(res, name, val) {
  const maxAge = 7 * 24 * 3600; // secunde
  const cookieStr = `${name}=${val}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}`;

  res.headers = res.headers || {};
  const prev = res.headers["Set-Cookie"];
  res.headers["Set-Cookie"] = prev
    ? (Array.isArray(prev) ? [...prev, cookieStr] : [prev, cookieStr])
    : cookieStr;

  // compat SWA (redundanță utilă)
  res.cookies = [
    {
      name,
      value: val,
      path: "/",
      httpOnly: true,
      sameSite: "None",
      secure: true,
      maxAge
    }
  ];
}

export function clearCookie(res, name) {
  const cookieStr = `${name}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`;

  res.headers = res.headers || {};
  const prev = res.headers["Set-Cookie"];
  res.headers["Set-Cookie"] = prev
    ? (Array.isArray(prev) ? [...prev, cookieStr] : [prev, cookieStr])
    : cookieStr;

  res.cookies = [
    {
      name,
      value: "",
      path: "/",
      httpOnly: true,
      sameSite: "None",
      secure: true,
      maxAge: 0
    }
  ];
}

/* ---- Request helper ----
   Extrage userul din cookie-ul appetora_token.
*/
export function verifyFromRequest(req) {
  const cookie = req?.headers?.cookie || "";
  const m = /appetora_token=([^;]+)/.exec(cookie);
  if (!m) return null;
  return verify(m[1]);
}
