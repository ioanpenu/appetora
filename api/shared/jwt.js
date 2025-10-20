import jwt from "jsonwebtoken";
const SECRET = process.env.JWT_SECRET || "devsecret";

export function sign(payload, opts = {}) {
  return jwt.sign(payload, SECRET, { expiresIn: opts.expiresIn || "7d" });
}
export function verify(token) {
  try { return jwt.verify(token, SECRET); } catch { return null; }
}

// Helper care setează cookie-ul atât în header, cât și în câmpul `cookies` (compat SWA)
export function setCookie(res, name, val) {
  const maxAge = 7 * 24 * 3600;
  const cookieStr = `${name}=${val}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
  res.headers = res.headers || {};
  res.headers["Set-Cookie"] = cookieStr;

  // redundanță utilă pentru unele gateway-uri
  res.cookies = [
    {
      name,
      value: val,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      maxAge
    }
  ];
}

export function clearCookie(res, name) {
  const cookieStr = `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  res.headers = res.headers || {};
  res.headers["Set-Cookie"] = cookieStr;

  res.cookies = [
    {
      name,
      value: "",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      maxAge: 0
    }
  ];
}
