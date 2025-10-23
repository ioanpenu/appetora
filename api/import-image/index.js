// api/import-image/index.js
import OpenAI from "openai";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// mic helper pentru răspunsuri JSON
const json = (status, body) => ({
  status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
});

export default async function (context, req) {
  try {
    // 1) Citește imaginea (dataURL sau base64 simplu)
    const { imageData, imageBase64 } = await readBody(req);
    if (!imageData && !imageBase64) {
      context.res = json(400, { error: "Missing imageData or imageBase64" });
      return;
    }

    // Normalizează într-un data URL
    const dataUrl = imageData
      ? String(imageData)
      : `data:image/jpeg;base64,${String(imageBase64)}`;

    // Protecție: refuză fișiere foarte mari (ex. > 8 MB în base64)
    const estBytes = Math.ceil((dataUrl.length - dataUrl.indexOf(",")) * 3 / 4);
    if (estBytes > 8 * 1024 * 1024) {
      context.res = json(413, { error: "Image too large (limit ~8MB)" });
      return;
    }

    // 2) OpenAI Vision
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const schema = {
      name: "RecipeExtraction",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          category: { type: "string" },
          ingredients: { type: "array", items: { type: "string" } },
          instructions: { type: "string" }
        },
        required: ["name", "ingredients", "instructions"]
      },
      strict: true
    };

    const prompt =
      "Extrage din imaginea atașată câmpurile rețetei în limba în care este textul din poză: " +
      "name (titlul), category (dacă există), ingredients (listă, câte un element per rând) " +
      "și instructions (text). Nu inventa. Dacă un câmp lipsește, lasă-l gol. " +
      "Răspunde DOAR în JSON, conform schemei.";

    const resp = await client.responses.create({
      model: MODEL,
      response_format: { type: "json_schema", json_schema: schema },
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: dataUrl }
          ]
        }
      ]
    });

    // 3) Extrage textul JSON din răspuns
    const text = pickFirstText(resp);
    if (!text) {
      context.res = json(502, { error: "No content from model" });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // fallback: când modelul nu respectă 100% schema,
      // încercăm să „mirosim” JSON-ul din text
      const m = text.match(/\{[\s\S]*\}$/);
      parsed = m ? JSON.parse(m[0]) : null;
    }

    if (!parsed) {
      context.res = json(502, { error: "Could not parse model output" });
      return;
    }

    // 4) Normalizează ușor câmpurile
    const out = {
      name: (parsed.name || "").trim(),
      category: (parsed.category || "").trim() || null,
      ingredients: Array.isArray(parsed.ingredients)
        ? parsed.ingredients.map(s => String(s).trim()).filter(Boolean)
        : [],
      instructions: (parsed.instructions || "").trim()
    };

    // validare minimă
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
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

// extrage primul text din Responses API
function pickFirstText(resp) {
  // forma tipică: resp.output[0].content[0].text
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
  // fallback: multe SDK-uri expun și choices/messages
  try {
    const t = resp?.choices?.[0]?.message?.content;
    if (typeof t === "string") return t;
  } catch {}
  return null;
}
