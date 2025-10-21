import { verify } from "../shared/jwt.js";
import { colUsage } from "../shared/cosmos.js";
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

    // ---- Rate limit: 5 imports per day per user ----
    const today = ymd(new Date());
    const pk = `usage#${uid}`;
    const id = `${uid}:${today}`;
    const { resource: dayDoc } = await colUsage.item(id, pk).read();
    const used = dayDoc?.imports || 0;
    const limit = 5;
    if (used >= limit) {
      return respond(context, 429, { error: "Daily limit reached (5 imports)" });
    }

    // ---- Call OpenAI to parse recipe ----
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

    // ---- Log usage (increment per-day doc) ----
    const nowIso = new Date().toISOString();
    const newDoc = {
      id, pk, uid,
      date: today,
      imports: (used + 1),
      updatedAt: nowIso
      // optional: tokens/cost if calculezi ulterior
    };
    await colUsage.items.upsert(newDoc);

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
