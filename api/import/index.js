
import OpenAI from "openai";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { getUserFromCookie } from "../shared/authz.js";
import { colUsage } from "../shared/cosmos.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const DAILY_LIMIT = 5;

export default async function (context, req) {
  const me = getUserFromCookie(req);
  if(!me) return { status:401, jsonBody:{error:"Unauthenticated"} };

  try {
    const bodyData = await body(req);
    const url = (req.query.url || bodyData.url || "").trim();
    const textInput = (bodyData.text || "").trim();

    if (!url && !textInput) return bad("Provide ?url=... or JSON {text:'...'}");
    if (url && /(youtube\.com|youtu\.be)\//i.test(url)) return { status:422, jsonBody:{ error:"YouTube links are not supported. Use a normal recipe URL or upload .txt." } };

    const today = new Date().toISOString().slice(0,10);
    const usageId = `${me.uid}-${today}`;
    let usageDoc; try { const { resource } = await colUsage.item(usageId, "usage").read(); usageDoc = resource; } catch { usageDoc = null; }
    if (usageDoc && usageDoc.calls >= DAILY_LIMIT) return { status:429, jsonBody:{ error:"Daily import limit reached (5)" } };

    const sourceText = textInput ? textInput : await fetchPageText(url);
    if (!sourceText || sourceText.length < 80) return { status:422, jsonBody:{ error:"Could not extract enough text" } };

    const schema = {
      name:"recipe",
      schema:{
        type:"object", additionalProperties:false,
        properties:{ name:{type:"string"}, category:{type:["string","null"]}, ingredients:{type:"array",items:{type:"string"}}, instructions:{type:"string"} },
        required:["name","ingredients","instructions"]
      }, strict:true
    };
    const prompt = [
      { role:"system", content:"You are a culinary extraction assistant. Return JSON only per schema. Do not translate Romanian text." },
      { role:"user", content:`SOURCE:${url?` ${url}`:" (text upload)"}\n\nCONTENT (may be Romanian):\n${sourceText.slice(0,12000)}\n\nExtract main recipe.` }
    ];
    const resp = await client.responses.create({ model:"gpt-4o-mini", input: prompt, response_format:{ type:"json_schema", json_schema: schema } });

    const usage = resp.usage || {};
    const inTok = usage.input_tokens||0, outTok = usage.output_tokens||0;
    const resultText = resp.output_text ?? resp.output?.[0]?.content?.[0]?.text ?? "";
    if(!resultText) return { status:500, jsonBody:{error:"Empty model response"} };
    const data = JSON.parse(resultText);
    data.category = data.category ?? null;
    data.name = String(data.name||"").trim();
    data.ingredients = Array.isArray(data.ingredients)?data.ingredients.map(s=>String(s).trim()).filter(Boolean):[];
    data.instructions = String(data.instructions||"").trim();

    const doc = usageDoc || { id:usageId, pk:"usage", userId:me.uid, date:today, calls:0, input_tokens:0, output_tokens:0, cost_usd:0 };
    doc.calls += 1; doc.input_tokens += inTok; doc.output_tokens += outTok;
    const cost = estimateCostUSD(inTok, outTok);
    doc.cost_usd = +(doc.cost_usd + cost).toFixed(6);
    await colUsage.items.upsert(doc);

    return { status:200, jsonBody: data };
  } catch(e) { context.log.error(e); return { status:500, jsonBody:{error:e.message} }; }

  function bad(msg){ return { status:400, jsonBody:{error:msg} }; }
  async function body(req){ if (!req.body) return {}; return typeof req.body==="string"?JSON.parse(req.body||"{}"):req.body; }
}

async function fetchPageText(url){
  const r = await fetch(url, { headers:{ "user-agent":"Mozilla/5.0 AppetoraBot/1.0" } });
  if(!r.ok) throw new Error(`Fetch failed (${r.status})`);
  const html = await r.text();
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  if(article?.textContent) return `${article.title||""}\n\n${article.textContent}`;
  return dom.window.document.body?.textContent || "";
}
function estimateCostUSD(inTok, outTok){
  const inPrice=0.00000015, outPrice=0.00000060; // approx for gpt-4o-mini
  return inTok*inPrice + outTok*outPrice;
}
