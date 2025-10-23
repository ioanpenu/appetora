// api/import-image/index.js
import OpenAI from "openai";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const json = (status, body) => ({
  status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
});

export default async function (context, req) {
  try {
    const { imageData, imageBase64 } = await readBody(req);
    if (!imageData && !imageBase64) {
      context.res = json(400, { error: "Missing imageData or imageBase64" });
      return;
    }

    // Normalizează într-un data URL
    const dataUrl = imageData
      ? String(imageData)
      : `data:image/jpeg;base64,${String(imageBase64)}`;

    // Limită ~8MB
    const estBytes = Math.ceil((dataUrl.length - dataUrl.indexOf(",")) * 3 / 4);
    if (estBytes > 8 * 1024 * 1024) {
      context.res = json(413, { error: "Image too large (limit ~8MB)" });
      return;
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Fără response_format / text_format — cerem JSON prin prompt și îl extragem robust.
    const system =
      "You are a precise recipe extractor. Only output strict JSON, nothing else.";
    const userPrompt =
      "Extract the recipe fields from the attached image. " +
      "Return JSON with keys: name (string), category (string or empty), " +
      "ingredients (array of strings, one item per ingredient), instructions (string). " +
      "Do NOT include any additional text. If a field is missing, return an empty string/array.";

    const resp = await client.responses.create({
      model: MODEL,
      input: [
        { role: "system", content: [{ type: "text", text: system }] },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            { type: "input_image", image_url: dataUrl }
          ]
        }
      ]
    });

    const text = pickFirstText(resp);
    if (!text) {
      context.res = json(502, { error: "No content from model" });
      return;
    }

    const parsed = safeParseJson(text);
    if (!parsed) {
      context.res = json(502, { error: "Could not parse model output as JSON" });
      return;
    }

    const out = {
      name: (parsed.name || "").trim(),
      category: (parsed.category || "").trim() || null,
      ingredients: Array.isArray(parsed.ingredients)
        ? parsed.ingredients.map((s) => String(s).trim()).filter(Boolean)
        : [],
      instructions: (parsed.instructions || "").trim()
    };

    if (!out.name && out.ingredients.length === 0 && !out.instructions) {
      context.res = json(422, { error: "Image did not contain a readable recipe" });
      return;
    }

    context.res = json(200, out);
  } catch (err) {
    context.log.error(err);
    const msg = err?.response?.data || err?.message || String(err);
    context.res = json(500, { error: msg });
  }
}

// ---- helpers

async function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function pickFirstText(resp) {
  try {
    if (typeof resp?.output_text === "string" && resp.output_text.trim()) {
      return resp.output_text;
    }
  } catch {}

  try {
    const blocks = resp?.output ?? [];
    for (const b of blocks) {
      const c = b?.content ?? [];
      for (const part of c) {
        if (part?.type === "output_text" && part?.text) return part.text;
        if (typeof part?.text === "string") return part.text;
      }
    }
  } catch {}

  try {
    const t = resp?.choices?.[0]?.message?.content;
    if (typeof t === "string") return t;
  } catch {}

  return null;
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // încearcă să extragi ultimul obiect JSON din text
    const m = text.match(/\{[\s\S]*\}$/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}
