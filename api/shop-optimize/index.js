// Lista de cumpărături „periată” pentru Bring!: un singur apel AI care
//  - unește produsele identice chiar dacă au nume diferite (bulion + pastă de roșii, roșie + roșii),
//  - adună cantitățile și le rotunjește la ce se cumpără (100 ml lapte -> 1 l, 1 ou -> 10 buc.),
//  - traduce numele în limba aleasă (de / en) sau le lasă în română (ro).
//   POST {lang:'de'|'en'|'ro', items:["500 g carne tocată", "2 × ceapă", ...]}
//     -> {items:[{name, spec, from:[indici]}], cached, aiError}
// Rezultatul se ține minte pentru aceeași listă (documentul shopopt_<uid> din history), ca redeschiderea
// dialogului să nu coste nimic. Corecturile de nume ale userului (memoria i18n) intră ca glosar.
import { createHash } from "node:crypto";
import OpenAI from "openai";
import { verifyFromRequest } from "../shared/jwt.js";
import { colHistory, colUsage } from "../shared/cosmos.js";

const LANGS = { de: "German", en: "English", ro: "Romanian" };
const DAILY_AI_CALLS = 40;
const PROMPT_VERSION = 2;
const json = (status, body) => ({ status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ymd = (d) => d.toISOString().slice(0, 10);

const SHOP = {
  de: { pack: "Packung", piece: "Stk.", bunch: "Bund", bottle: "Flasche", head: "Knolle", ex: "1 l Milch, 10 Stk. Eier, 1 Packung Reis, 1 Bund Petersilie, 1 Knolle Knoblauch, 500 g Hackfleisch, 1 Dose Tomatenmark, 1 Flasche Weißwein" },
  en: { pack: "pack", piece: "pcs", bunch: "bunch", bottle: "bottle", head: "bulb", ex: "1 l Milk, 10 pcs Eggs, 1 pack Rice, 1 bunch Parsley, 1 bulb Garlic, 500 g Minced meat, 1 can Tomato paste, 1 bottle White wine" },
  ro: { pack: "pachet", piece: "buc.", bunch: "legătură", bottle: "sticlă", head: "căpățână", ex: "1 l lapte, 10 buc. ouă, 1 pachet orez, 1 legătură pătrunjel, 1 căpățână usturoi, 500 g carne tocată, 1 cutie pastă de roșii, 1 sticlă vin alb" }
};

function systemPrompt(lang, glossary) {
  const L = LANGS[lang], S = SHOP[lang];
  return [
    `You turn the ingredients of several recipes (mostly written in Romanian) into a short, practical supermarket shopping list in ${L}, for the Bring! shopping list app.`,
    `Rules:`,
    `1. Merge items that are the same thing to buy, even if written differently or in singular/plural (e.g. "1 roșie" + "2-3 roșii"; "2 linguri bulion" + "2 linguri pastă de roșii" are both tomato paste; "ou" + "ouă").`,
    `   Do NOT merge different products (red onions vs onions, beef vs minced meat, cherry tomatoes vs tomatoes).`,
    `2. Add up quantities, then round to what you actually buy:`,
    `   - liquids (milk, cream, wine, stock): a normal package (e.g. 1 l milk, 200 ml cream, 1 ${S.bottle} wine);`,
    `   - spoons, teaspoons, pinches, small amounts of pantry goods (rice 80 g, flour, sugar, tomato paste, spices, oil): one package ("1 ${S.pack}", or the usual container) or no quantity;`,
    `   - eggs: round up to 6 or 10; garlic cloves: "1 ${S.head}"; fresh herbs: "1 ${S.bunch}";`,
    `   - meat, cheese, vegetables sold by weight: sum and round up to the next 50 g (keep kg for >= 1 kg);`,
    `   - pieces (onions, carrots, tomatoes): sum, ranges take the upper bound, round up to whole pieces.`,
    `3. Product names: short generic names as in the Bring! catalog in ${L}, no quantities in the name, no brands; keep a qualifier only when it changes the product.`,
    `4. "spec" is the quantity to buy in ${L}, short (e.g. ${S.ex}), or "" if not needed.`,
    glossary.length ? `5. Always use these preferred names chosen by the user: ${glossary.map(([a, b]) => `"${a}" → "${b}"`).join("; ")}.` : ``,
    `Every input index must appear in exactly one output item's "from" list.`,
    `Return JSON: {"items":[{"name":"...","spec":"...","from":[0,3]}]}.`
  ].filter(Boolean).join("\n");
}

function parseAi(text, n) {
  let data;
  try { data = JSON.parse(text); } catch { const m = /\{[\s\S]*\}/.exec(text); try { data = m ? JSON.parse(m[0]) : null; } catch { data = null; } }
  const arr = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : Object.values(data || {}).find(Array.isArray);
  if (!Array.isArray(arr)) return null;
  const used = new Set();
  const items = [];
  for (const it of arr) {
    const name = String(it?.name ?? "").trim().slice(0, 80);
    const spec = String(it?.spec ?? it?.quantity ?? "").trim().slice(0, 40);
    const from = (Array.isArray(it?.from) ? it.from : []).map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < n && !used.has(i));
    if (!name || !from.length) continue;
    from.forEach((i) => used.add(i));
    items.push({ name, spec, from });
  }
  return { items, missing: [...Array(n).keys()].filter((i) => !used.has(i)) };
}

export default async function (context, req) {
  try {
    const me = verifyFromRequest(req);
    if (!me) return (context.res = json(401, { error: "No session" }));
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const lang = LANGS[b.lang] ? b.lang : "de";
    const labels = (Array.isArray(b.items) ? b.items : []).map((x) => String(x || "").trim().slice(0, 120)).filter(Boolean).slice(0, 150);
    if (!labels.length) return (context.res = json(200, { items: [] }));

    const pk = `history#${me.uid}`;
    // glosarul userului: numele corectate de mână (memoria i18n)
    let glossary = [];
    if (lang !== "ro") {
      try {
        const { resource: mem } = await colHistory.item(`i18n_${me.uid}_${lang}`, pk).read();
        glossary = Object.keys(mem?.manual || {}).map((k) => [k, mem.map[k]]).filter(([, v]) => v).slice(0, 60);
      } catch (e) { if (e.code !== 404) throw e; }
    }

    // aceeași listă, aceeași limbă, același glosar -> rezultatul salvat
    const hash = createHash("sha1").update(JSON.stringify([PROMPT_VERSION, lang, labels, glossary])).digest("hex");
    const cid = `shopopt_${me.uid}`;
    let cache = null;
    try { ({ resource: cache } = await colHistory.item(cid, pk).read()); } catch (e) { if (e.code !== 404) throw e; }
    if (cache?.hash === hash && Array.isArray(cache.items)) return (context.res = json(200, { items: cache.items, cached: true }));

    const uid = me.uid, upk = `usage#${uid}`, did = `${uid}:${ymd(new Date())}`;
    let day = null;
    try { ({ resource: day } = await colUsage.item(did, upk).read()); } catch (e) { if (e.code !== 404) throw e; }
    if ((day?.translations || 0) >= DAILY_AI_CALLS) return (context.res = json(429, { error: "Ai atins limita de liste optimizate pe azi." }));

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    let calls = 0, tokens = 0;
    const ask = async (lines) => {
      const resp = await openai.chat.completions.create({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt(lang, glossary) },
          { role: "user", content: JSON.stringify(lines.map((text, i) => ({ i, text }))) }
        ]
      });
      calls++; tokens += resp.usage?.total_tokens || 0;
      const content = resp.choices?.[0]?.message?.content || "";
      return { parsed: parseAi(content, lines.length), content };
    };

    let first;
    try { first = await ask(labels); }
    catch (e) { return (context.res = json(200, { items: null, aiError: `OpenAI (${model}): ${e?.message || e}` })); }
    const parsed = first.parsed;
    if (!parsed || !parsed.items.length) {
      await logUsage(); return (context.res = json(200, { items: null, aiError: "Răspuns AI neclar: " + first.content.slice(0, 200) }));
    }

    // la listele lungi AI-ul mai omite câte un rând: a doua cerere, doar cu ce a lipsit
    if (parsed.missing.length) {
      const miss = parsed.missing;
      try {
        const second = (await ask(miss.map((i) => labels[i]))).parsed;
        if (second) {
          for (const it of second.items) parsed.items.push({ ...it, from: it.from.map((j) => miss[j]) });
          parsed.missing = second.missing.map((j) => miss[j]);
        }
      } catch (e) { context.log?.warn?.(`shop-optimize retry: ${e?.message || e}`); }
    }
    // ce tot a scăpat rămâne pe listă, neatins (marcat în interfață)
    for (const i of parsed.missing) parsed.items.push({ name: labels[i], spec: "", from: [i], untouched: true });
    await logUsage();

    async function logUsage() {
      await colUsage.items.upsert({
        ...(day || { id: did, pk: upk, uid, date: ymd(new Date()), imports: 0 }),
        translations: (day?.translations || 0) + calls,
        translatedItems: (day?.translatedItems || 0) + labels.length,
        translateTokens: (day?.translateTokens || 0) + tokens,
        updatedAt: new Date().toISOString()
      });
    }

    await colHistory.items.upsert({ id: cid, pk, kind: "shopopt", userId: uid, hash, lang, items: parsed.items, updatedAt: new Date().toISOString() });
    context.res = json(200, { items: parsed.items, cached: false });
  } catch (e) {
    context.log?.error?.(e);
    context.res = json(500, { error: e?.message || String(e) });
  }
}
