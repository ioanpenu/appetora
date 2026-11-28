// Traduce lista de cumpărături pentru Bring! (rețetele rămân în limba lor).
//   POST {lang:'de'|'en', items:["500 g carne tocată", ...]}
//     -> {items:[{src, spec, srcName, key, name, cached, manual}]}
//   POST {lang, learn:{<key>: "Hackfleisch"}}   corecturile userului, câștigă data viitoare
// Cantitatea și unitatea se traduc local (dicționar); doar numele produsului trece prin AI,
// o singură dată: rezultatul se ține minte per user (documentul i18n_<uid>_<lang> din history).
import OpenAI from "openai";
import { verifyFromRequest } from "../shared/jwt.js";
import { colHistory, colUsage } from "../shared/cosmos.js";

const LANGS = { de: "German", en: "English" };
const DAILY_AI_CALLS = 40;
const json = (status, body) => ({ status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const ymd = (d) => d.toISOString().slice(0, 10);

// unități: forma normalizată (fără diacritice) -> [de, en]; null = păstrează cum e
const UNITS = [
  [/^(g|gr|grame?)$/, ["g", "g"]], [/^kg$/, ["kg", "kg"]], [/^ml$/, ["ml", "ml"]], [/^(l|litri?|litru)$/, ["l", "l"]],
  [/^(buc|bucati|bucata)\.?$/, ["Stk.", "pcs"]],
  [/^(lingura|linguri|lg)\.?$/, ["EL", "tbsp"]], [/^(lingurita|lingurite|lgt)\.?$/, ["TL", "tsp"]],
  [/^(cana|cani)$/, ["Tasse", "cup"]], [/^(pahar|pahare)$/, ["Glas", "glass"]],
  [/^(legatura|legaturi)$/, ["Bund", "bunch"]], [/^(catel|catei)$/, ["Zehe", "clove"]],
  [/^(pachet|pachete)$/, ["Packung", "pack"]], [/^(conserva|conserve|cutie|cutii)$/, ["Dose", "can"]],
  [/^(felie|felii)$/, ["Scheibe", "slice"]], [/^(praf)$/, ["Prise", "pinch"]], [/^(plic|plicuri)$/, ["Päckchen", "sachet"]],
  [/^(tbsp|tsp|cup|cups|can|cans|clove|cloves|bunch|pinch|pcs|el|tl)$/, null]
];
const WORD_NUM = { o: "1", un: "1", una: "1", doi: "2", doua: "2", trei: "3", patru: "4", cinci: "5", jumatate: "½" };

// „500 g de carne tocată (proaspătă)” -> {spec:"500 g", name:"carne tocată"}
function split(label, lang) {
  const rest = String(label).replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const words = rest.split(" ");
  let qty = "", unit = "", i = 0;
  const glued = /^([\d.,]+)([a-zA-Z]+)$/.exec(words[0] || "");          // „1kg”
  if (glued) { qty = glued[1]; words.splice(0, 1, glued[2]); }
  else if (/^[\d½¼¾][\d.,/½¼¾-]*$/.test(words[0] || "")) { qty = words[0]; i = 1; }
  else if (WORD_NUM[norm(words[0])] && words.length > 1) { qty = WORD_NUM[norm(words[0])]; i = 1; }
  if (qty) {
    const w = norm(words[i] || "");
    for (const [re, tr] of UNITS) if (re.test(w)) { unit = tr ? tr[lang === "en" ? 1 : 0] : words[i]; i++; break; }
  }
  if (norm(words[i]) === "de" && qty) i++;
  const name = words.slice(i).join(" ").trim() || rest;
  return { spec: [qty, unit].filter(Boolean).join(" "), name };
}

export default async function (context, req) {
  try {
    const me = verifyFromRequest(req);
    if (!me) return (context.res = json(401, { error: "No session" }));
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const lang = LANGS[b.lang] ? b.lang : null;
    if (!lang) return (context.res = json(400, { error: "Limbă necunoscută." }));

    const pk = `history#${me.uid}`, id = `i18n_${me.uid}_${lang}`;
    let mem = null;
    try { ({ resource: mem } = await colHistory.item(id, pk).read()); } catch (e) { if (e.code !== 404) throw e; }
    mem = mem || { id, pk, kind: "i18n", userId: me.uid, lang, map: {}, manual: {} };
    mem.map = mem.map || {}; mem.manual = mem.manual || {};

    // corecturi de la user
    if (b.learn && typeof b.learn === "object") {
      for (const [k, v] of Object.entries(b.learn).slice(0, 200)) {
        const key = norm(k).slice(0, 120), val = String(v || "").trim().slice(0, 80);
        if (key && val) { mem.map[key] = val; mem.manual[key] = 1; }
      }
      mem.updatedAt = new Date().toISOString();
      await colHistory.items.upsert(mem);
      return (context.res = json(200, { ok: true }));
    }

    const labels = (Array.isArray(b.items) ? b.items : []).map((x) => String(x || "").trim()).filter(Boolean).slice(0, 150);
    if (!labels.length) return (context.res = json(200, { items: [] }));
    const rows = labels.map((src) => { const { spec, name } = split(src, lang); return { src, spec, srcName: name, key: norm(name).slice(0, 120) }; });

    const missing = [...new Set(rows.filter((r) => !mem.map[r.key]).map((r) => r.srcName))];
    if (missing.length) {
      // limită zilnică de apeluri AI, separată de importul de rețete
      const uid = me.uid, upk = `usage#${uid}`, did = `${uid}:${ymd(new Date())}`;
      let day = null;
      try { ({ resource: day } = await colUsage.item(did, upk).read()); } catch (e) { if (e.code !== 404) throw e; }
      if ((day?.translations || 0) >= DAILY_AI_CALLS) return (context.res = json(429, { error: "Ai atins limita de traduceri pe azi." }));

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const resp = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content:
            `You translate grocery items (mostly Romanian) into ${LANGS[lang]} for the Bring! shopping list app. ` +
            `Use the short generic product name exactly as it appears in the Bring! catalog in ${LANGS[lang]}, ` +
            (lang === "de"
              ? "e.g. Zwiebeln, Kartoffeln, Karotten, Eier, Hackfleisch, Saure Sahne, Knoblauch, Dill, Petersilie, Paprika, Reis, Mehl, Butter, Milch. "
              : "e.g. Onions, Potatoes, Carrots, Eggs, Minced meat, Sour cream, Garlic, Dill, Parsley. ") +
            `No quantities, no units, no brand names; keep a qualifier only when it changes the product (e.g. "Saure Sahne"). ` +
            `Return JSON {"items":[{"i":<index>,"name":"..."}]} with one entry per input index.` },
          { role: "user", content: JSON.stringify(missing.map((name, i) => ({ i, name }))) }
        ]
      });
      let out = {};
      try { out = JSON.parse(resp.choices?.[0]?.message?.content || "{}"); } catch { out = {}; }
      for (const it of Array.isArray(out.items) ? out.items : []) {
        const src = missing[it?.i], name = String(it?.name || "").trim().slice(0, 80);
        if (src && name) mem.map[norm(src).slice(0, 120)] = name;
      }
      mem.updatedAt = new Date().toISOString();
      await colHistory.items.upsert(mem);

      const usage = resp.usage || {};
      await colUsage.items.upsert({
        ...(day || { id: did, pk: upk, uid, date: ymd(new Date()), imports: 0 }),
        translations: (day?.translations || 0) + 1,
        translatedItems: (day?.translatedItems || 0) + missing.length,
        translateTokens: (day?.translateTokens || 0) + (usage.total_tokens || 0),
        updatedAt: new Date().toISOString()
      });
    }

    context.res = json(200, {
      items: rows.map((r) => ({
        src: r.src, spec: r.spec, srcName: r.srcName, key: r.key,
        name: mem.map[r.key] || r.srcName,
        cached: !missing.includes(r.srcName), manual: !!mem.manual[r.key]
      }))
    });
  } catch (e) {
    context.log?.error?.(e);
    context.res = json(500, { error: e?.message || String(e) });
  }
}
