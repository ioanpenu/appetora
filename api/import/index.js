import { verify } from "../shared/jwt.js";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import OpenAI from "openai";

export default async function (context, req) {
  try {
    // auth
    const cookie = (req.headers && req.headers.cookie) || "";
    const m = /appetora_token=([^;]+)/.exec(cookie);
    if (!m) return respond(context, 401, { error: "No session" });
    const me = verify(m[1]);
    if (!me) return respond(context, 401, { error: "Invalid session" });

    const b = await readBody(req);
    let sourceText = "";

    if (b.url) {
      // fetch page HTML
      const page = await fetch(b.url, { headers: { "user-agent": "Mozilla/5.0 AppetoraBot/1.0" } });
      if (!page.ok) return respond(context, 400, { error: `Failed to fetch URL (${page.status})` });
      const html = await page.text();

      // extract main content
      const dom = new JSDOM(html, { url: b.url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();
      sourceText = (article?.textContent || "").trim();
      if (!sourceText) {
        // fallback to raw text nodes
        sourceText = dom.window.document.body?.textContent?.trim() || "";
      }
      if (!sourceText) return respond(context, 400, { error: "Could not extract text" });
    } else if (b.text) {
      sourceText = String(b.text || "").trim();
      if (!sourceText) return respond(context, 400, { error: "Empty text" });
    } else {
      return respond(context, 400, { error: "Provide url or text" });
    }

    // call OpenAI to parse a recipe in Romanian -> structured JSON
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = [
      { role: "system", content: "You are a precise recipe parser. Return strict JSON with keys: name, category, ingredients (array of strings), instructions (string). Language is Romanian if the source is Romanian." },
      { role: "user", content: "Extrage structurat rețeta din textul de mai jos.\n\nText:\n" + truncate(sourceText, 15000) + "\n\nOutput JSON STRICT:\n{\n  \"name\": \"...\",\n  \"category\": \"...\",\n  \"ingredients\": [\"...\"],\n  \"instructions\": \"...\"\n}\n" }
    ];

    // folosim Responses API (model GPT-4o-mini e ieftin & bun la extracție)
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      messages: prompt
    });

    const raw = resp.choices?.[0]?.message?.content || "";
    let parsed = safeJson(raw);
    if (!parsed || typeof parsed !== "object") {
      // încearcă din nou doar să extragi JSON
      const resp2 = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [
          { role: "system", content: "Return only valid JSON. No commentary." },
          { role: "user", content: "Transforma în JSON valid următorul conținut:\n" + raw }
        ]
      });
      parsed = safeJson(resp2.choices?.[0]?.message?.content || "");
    }

    // normalize
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

    return respond(context, 200, out);
  } catch (e) {
    context.log.error(e);
    return respond(context, 500, { error: e.message });
  }
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
