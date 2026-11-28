import { verify } from "../shared/jwt.js";
import { colUsage, colUsers } from "../shared/cosmos.js";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import OpenAI from "openai";

export default async function (context, req) {
  try {
    // auth (cookie JWT de user)
    const cookie = (req.headers && req.headers.cookie) || "";
    const m = /appetora_token=([^;]+)/.exec(cookie);
    if (!m) return respond(context, 401, { error: "No session" });
    const me = verify(m[1]);
    if (!me) return respond(context, 401, { error: "Invalid session" });
    const uid = me.uid;

    const b = await readBody(req);
    let sourceText = "";

    if (b.url) {
      const page = await fetch(b.url, { headers: { "user-agent": "Mozilla/5.0 AppetoraBot/1.0" } });
      if (!page.ok) return respond(context, 400, { error: `Failed to fetch URL (${page.status})` });
      const html = await page.text();

      // 1) rețeta structurată (schema.org/Recipe) din pagină: exactă, fără AI, fără cost,
      //    nu intră în limita zilnică. Majoritatea site-urilor de rețete o au.
      const ld = findRecipeLd(html);
      const fromLd = ld && recipeFromLd(ld);
      if (fromLd && fromLd.ingredients.length) return respond(context, 200, { ...fromLd, source: "schema.org" });

      // 2) altfel: textul paginii, interpretat de AI
      const dom = new JSDOM(html, { url: b.url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();
      sourceText = (article?.textContent || "").trim();
      if (!sourceText) sourceText = dom.window.document.body?.textContent?.trim() || "";
      if (!sourceText) return respond(context, 400, { error: "Could not extract text" });
    } else if (b.text) {
      sourceText = String(b.text || "").trim();
      if (!sourceText) return respond(context, 400, { error: "Empty text" });
    } else {
      return respond(context, 400, { error: "Provide url or text" });
    }

    // ---- citește userul pentru a vedea dacă are noLimit ----
    let noLimit = false;
    try {
      const { resource: udoc } = await colUsers.item(uid, "users").read();
      if (udoc && (udoc.noLimit === true || udoc.role === "pro")) noLimit = true;
    } catch { /* ignore */ }

    // ---- Rate limit: 5 imports per day per user (dacă nu e noLimit) ----
    const today = ymd(new Date());
    const pk = `usage#${uid}`;
    const id = `${uid}:${today}`;
    let used = 0;

    if (!noLimit) {
      const { resource: dayDoc } = await colUsage.item(id, pk).read();
      used = dayDoc?.imports || 0;
      const limit = 5;
      if (used >= limit) {
        return respond(context, 429, { error: "Daily limit reached (5 imports)" });
      }
    }

    // ---- OpenAI parse ----
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const messages = [
      { role: "system", content: "You are a precise recipe parser. Return strict JSON with keys: name, category, ingredients (array of strings), instructions (string). Language is Romanian if the source is Romanian." },
      { role: "user", content: "Extrage structurat rețeta din textul de mai jos.\n\nText:\n" + truncate(sourceText, 15000) + "\n\nOutput JSON STRICT:\n{\n  \"name\": \"...\",\n  \"category\": \"...\",\n  \"ingredients\": [\"...\"],\n  \"instructions\": \"...\"\n}\n" }
    ];

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      messages
    });

    const raw = resp.choices?.[0]?.message?.content || "";
    let parsed = safeJson(raw);
    if (!parsed || typeof parsed !== "object") {
      const resp2 = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [
          { role: "system", content: "Return only valid JSON. No commentary." },
          { role: "user", content: "Transformă în JSON valid următorul conținut:\n" + raw }
        ]
      });
      parsed = safeJson(resp2.choices?.[0]?.message?.content || "");
    }

    const out = {
      name: String(parsed?.name || "").trim(),
      category: String(parsed?.category || "").trim(),
      ingredients: Array.isArray(parsed?.ingredients)
        ? parsed.ingredients.map(x=>String(x).trim()).filter(Boolean)
        : [],
      instructions: String(parsed?.instructions || "").trim()
    };
    if (!out.name && out.instructions) {
      out.name = out.instructions.slice(0, 40) + "…";
    }

    // ---- Log usage (increment per-day doc) dacă e limitat ----
    if (!noLimit) {
      const nowIso = new Date().toISOString();
      const newDoc = {
        id, pk, uid,
        date: today,
        imports: (used + 1),
        updatedAt: nowIso
      };
      await colUsage.items.upsert(newDoc);
    }

    return respond(context, 200, out);
  } catch (e) {
    context.log.error(e);
    return respond(context, 500, { error: e.message });
  }
}

function ymd(d){
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,'0');
  const da = String(d.getUTCDate()).padStart(2,'0');
  return `${y}-${m}-${da}`;
}

function respond(context, status, obj) {
  context.res = {
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(obj)
  };
}
async function readBody(req) {
  if (!req.body) return {};
  return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
}
function truncate(s, n){ return s.length>n ? s.slice(0,n) : s; }
function safeJson(s){
  try{
    const m = /{[\s\S]*}/.exec(s);
    const j = m ? m[0] : s;
    return JSON.parse(j);
  }catch{ return null; }
}

/* ---------- rețeta structurată (schema.org/Recipe) ----------
   Caută în <script type="application/ld+json"> și, pentru site-urile construite cu JavaScript
   (ex. Picnic, Next.js), și în blocurile de date unde JSON-ul e scris cu ghilimele escapate. */
function balancedObject(s, start) {
  let depth = 0, inStr = false, esc = false;
  for (let j = start; j < s.length; j++) {
    const c = s[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return s.slice(start, j + 1); }
  }
  return null;
}
function isRecipe(o) {
  const t = o && typeof o === "object" ? o["@type"] : null;
  return t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"));
}
function findRecipeIn(o) {
  if (Array.isArray(o)) { for (const x of o) { const r = findRecipeIn(x); if (r) return r; } return null; }
  if (o && typeof o === "object") {
    if (isRecipe(o)) return o;
    for (const k of ["@graph", "mainEntity", "itemListElement"]) if (k in o) { const r = findRecipeIn(o[k]); if (r) return r; }
  }
  return null;
}
function findRecipeLd(html) {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const r = findRecipeIn(JSON.parse(m[1])); if (r) return r; } catch { /* JSON stricat, următorul */ }
  }
  const unescaped = html.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  for (const text of [html, unescaped]) {
    for (const m of text.matchAll(/"@type"\s*:\s*"Recipe"/g)) {
      let k = m.index;
      for (let tries = 0; tries < 60; tries++) {
        k = text.lastIndexOf("{", k - 1);
        if (k < 0) break;
        const blob = balancedObject(text, k);
        if (!blob || k + blob.length <= m.index) continue;
        try { const r = findRecipeIn(JSON.parse(blob)); if (r) return r; } catch { /* încearcă o acoladă mai sus */ }
      }
    }
  }
  return null;
}
function cleanText(s) {
  return String(s ?? "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/[ \t]+/g, " ").trim();
}
function stepsFromLd(ins) {
  if (!ins) return [];
  if (typeof ins === "string") return cleanText(ins).split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(ins)) return ins.flatMap((x) => {
    if (typeof x === "string") return [cleanText(x)];
    if (x && (x["@type"] === "HowToSection" || Array.isArray(x.itemListElement))) return stepsFromLd(x.itemListElement);
    return [cleanText(x?.text || x?.name || "")];
  }).filter(Boolean);
  if (ins.itemListElement) return stepsFromLd(ins.itemListElement);
  return [];
}
function recipeFromLd(r) {
  const cat = Array.isArray(r.recipeCategory) ? r.recipeCategory[0] : r.recipeCategory;
  const ingr = Array.isArray(r.recipeIngredient) ? r.recipeIngredient : Array.isArray(r.ingredients) ? r.ingredients : [];
  return {
    name: cleanText(r.name || r.headline || ""),
    category: cleanText(cat || "").split(",")[0].trim(),
    ingredients: ingr.map(cleanText).filter(Boolean),
    instructions: stepsFromLd(r.recipeInstructions).join("\n")
  };
}
