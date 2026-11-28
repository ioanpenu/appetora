# Appetora: context pentru Claude Code

## Ce este
Appetora (www.appetora.com) e un proiect personal: un caiet de rețete multi-user cu plan de meniu săptămânal.
- Fiecare utilizator are propria bază de rețete (nume, categorie, ingrediente, instrucțiuni, poză, regim).
- Generează un meniu pe 7 zile. Rețetele „scoase din meniu” (`paused: true`) nu intră în generare.
- Lista de cumpărături se face din rețetele din plan și se poate trimite în Bring!.
- Importul cu AI (OpenAI) citește rețeta dintr-o poză, dintr-un link sau dintr-un text și completează formularul.
- Se poate instala ca aplicație (PWA) pe Android și iPhone.

Repo: `https://github.com/ioanpenu/appetora` (public, ramura `main`). Fiecare push pe `main` face deploy automat.
Fiecare PR primește un mediu de test (`https://ambitious-hill-00a312203-<nr PR>.westeurope.3.azurestaticapps.net`), șters automat la închiderea PR-ului.
Domeniul e **appetora.com** (nu .ro); varianta fără www are eroare de certificat (necorectat).

## Stack
- **Azure Static Web Apps**: frontend static, fără build. Workflow: `.github/workflows/azure-static-web-apps-ambitious-hill-00a312203.yml`, autentificare GitHub OIDC. Jobul de închidere a PR-urilor are nevoie și de `github_id_token`, nu doar de token-ul API.
- **Azure Functions** în `/api`: Node, ESM, modelul v3, câte un `function.json` per funcție. **Un singur export (default) per `index.js`**; un export în plus face funcția să nu mai pornească (500 fără mesaj).
- **Cosmos DB NoSQL Serverless**: baza `recipesdb`, containerele `users`, `recipes`, `history`, `usage`, toate cu partition key `/pk`.
- **Azure Blob Storage** pentru poze (SAS prin `/api/upload-url` și `/api/view-url`).
- **OpenAI**: `gpt-4o-mini` (sau `OPENAI_MODEL`), cheia `OPENAI_API_KEY`. Nu trimite `temperature` (unele modele îl resping). Contul e preplătit: când se termină creditul, toate funcțiile AI dau 429.
- **Auth**: email + parolă (bcrypt), JWT în cookie-ul HttpOnly `appetora_token`.
- În funcții, antetul `host` e o adresă internă (`…azurewebsites.net`); adresa publică vine din browser (`location.origin`, verificată).

## Structura fișierelor
```
index.html          interfața (HTML + CSS + JS vanilla, un singur fișier)
legacy.html         interfața veche (de șters când nu mai e nevoie)
admin.html          dashboard admin (useri, importuri din link/text); nu arată încă pozele și traducerile
manifest.json, sw.js  PWA: instalare, pornire fără internet (rețete, plan, setări salvate)
images/icons/       iconițele aplicației (simbolul auriu pe verde)
api/<functie>/      index.js + function.json
mock_server.py      API simulat pentru teste locale (Python, fără Node)
```

## Contractul API
| Endpoint | Ce face |
|---|---|
| `/api/auth/*` (register, login, me, logout) | autentificare |
| `GET/POST/PUT/DELETE /api/recipes` | CRUD rețete; câmpuri: `name, category, ingredients[], instructions, paused, imageBlob, diet` (`diet`: `vegan`/`vegetarian`/`omnivor`/`null` = detectat automat în interfață) |
| `POST /api/upload-url`, `GET /api/view-url` | poze în Blob |
| `POST /api/import` `{url}`/`{text}` | limită 5/zi, contorizată în `usage.imports` |
| `POST /api/import-image` | **fără limită zilnică și fără contorizare** (vezi TODO) |
| `GET /api/usage/today` | consumul de azi |
| `POST /api/plan-save` `{plan:[{date,recipeId,name,category,locked}]}` · `GET /api/plan-latest` | plan în `history` (`kind: manual_plan`) |
| `GET/PUT /api/settings` | setări per user, sincronizate: `excl, vegDays, veganDays, bringLang, bringOptimize, shopChecked` (document `settings_<uid>` în `history`) |
| `POST/GET /api/bring-list` | POST (logat) salvează lista pentru Bring! (id aleator, expiră în 2 zile, `pk = bring#<id>`); GET public = pagină schema.org/Recipe JSON-LD citită de Bring! (`?id=demo` = listă fixă de test) |
| `POST /api/shop-optimize` `{lang:'de'/'en'/'ro', items:[linii din rețete]}` | AI: unește dublurile, rotunjește cantitățile la ce se cumpără, traduce; a doua cerere pentru rândurile omise; rândurile vagi în `dropped`; rezultat ținut minte (`shopopt_<uid>`); limită 40 apeluri/zi în `usage.translations` |
| `POST /api/translate-items` | traducere simplă, produs cu produs, cu memorie per user (`i18n_<uid>_<lang>`); corecturile (`learn`) devin glosar pentru shop-optimize |
| `/api/adm/*` | pentru admin.html |

## Funcții în interfață
- **Plan**: 7 zile, zile blocate, generare cu evitarea categoriei din ziua vecină și a rețetelor din planul anterior. La pornire câștigă cel mai recent dintre ciorna locală și planul de pe server.
- **Zile fără carne**: o apăsare = vegetarian, două = vegan. Regimul rețetei se detectează din ingrediente (carne/pește → omnivor; ouă, lactate, miere → vegetarian; variantele vegetale ca „lapte de cocos” nu contează) sau se alege în formular.
- **Modul de gătit**: ecran întreg, un pas pe rând, cronometre detectate din text, Wake Lock.
- **Bring!**: importul oficial Bring! (`api.getbring.com/rest/bringrecipes/deeplink?url=…&source=web`). Parserul se poate testa direct: `https://api.getbring.com/rest/bringrecipes/parser?url=<pagina>`.
- **PWA**: bară de instalare (buton pe Android, „Arată pașii” pe iPhone), partajare link → import pe Android, bandă „fără internet”.

## Pași următori
1. **Limită zilnică și contorizare pentru `/api/import-image`** (cel mai scump apel AI; probabil a consumat creditul OpenAI).
2. **Portalul admin**: consum pe zi pentru importuri din poză și pentru Bring! (`translations`, `translateTokens`), cu cost estimat.
3. Curățenie: `api/plan`, `diag`, `zcheck`, `ping`; README încă descrie `admin-login`/`admin-metrics`; `legacy.html`.
4. Idei: porții și scalarea cantităților, mai multe mese pe zi, plan comun pentru familie, resetare de parolă.

## Testare locală
`python mock_server.py` din rădăcina repo-ului (port 8080, `AUTHED=1` pentru a porni logat), apoi http://localhost:8080. Simulează și setările, planurile salvate, Bring! și traducerile (dicționar mic). Pe calculatorul de acasă nu e instalat Node.

## Preferințe ale autorului
- Comunicarea se face în română, iar interfața e tot în română.
- Fără pas de build: frontend-ul rămâne HTML, CSS și JS vanilla, servit static.
- Fără referințe religioase în interfață (zile „fără carne”, nu „de post”).
- Funcțiile noi trec prin PR + mediu de test; merge doar după confirmarea lui.
