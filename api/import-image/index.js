// api/import-image/index.js — Responses API (input_text + input_image)
import OpenAI from "openai";
import { verifyFromRequest } from "../shared/jwt.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const json = (status, body) => ({
  status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
});

export default async function (context, req) {
  try {
    // auth
    const me = verifyFromRequest(req);
    if (!me) return (context.res = json(401, { error: "No session" }));

    // body
    const b = await readBody(req);
    const imageData = (b && b.imageData) || "";
    if (!imageData || !/^data:image\/(png|jpe?g|webp);base64,/.test(imageData)) {
      return (context.res = json(400, { error: "imageData must be a data URL (png/jpg/webp)" }));
    }

    // prompt: extrage JSON strict
    const prompt =
      `Extract a cooking recipe from the image and return ONLY compact JSON:\n` +
      `{"name": "...", "category": "...", "ingredients": ["..."], "instructions": "..." }\n` +
      `- "ingredients" is an array of strings (one item per line)\n` +
      `- "category" can be null or a short tag (e.g., "Dinner")\n` +
      `No extra commentary. Return valid JSON only.`;

    // Responses API: content parts MUST be input_text / input_image
    const resp = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: imageData }
          ]
        }
      ],
      temperature: 0.2
    });

    // Conveniență: .output_text; fallback dacă nu e populat
    const text =
      (resp.output_text && resp.output_text.trim()) ||
      // fallback generic:
      (resp.output?.[0]?.content?.[0]?.text || "").trim();

    if (!text) {
      return (context.res = json(500, { error: "No text returned from model" }));
    }

    // încearcă să parsezi JSON-ul
    let obj;
    try { obj = JSON.parse(text); }
    catch {
      // uneori modelul pune ```json ... ```
      const m = /{[\s\S]*}/.exec(text);
      if (!m) return (context.res = json(500, { error: "Model did not return JSON", raw: text.slice(0, 2000) }));
      obj = JSON.parse(m[0]);
    }

    // normalizare minimă
    const out = {
      name: String(obj.name || "").trim(),
      category: obj.category ? String(obj.category).trim() : "",
      ingredients: Array.isArray(obj.ingredients) ? obj.ingredients.map(x => String(x)).filter(Boolean) : [],
      instructions: String(obj.instructions || "").trim()
    };

    context.res = json(200, out);
  } catch (e) {
    context.log?.error?.(e);
    context.res = json(500, { error: e?.message || String(e) });
  }
}

async function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}
