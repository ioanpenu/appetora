# Appetora

A lightweight weekly recipe planner with:
- Email/password auth (cookie-based session).
- Add/edit recipes, pause/resume, daily pick, history.
- Import recipes from **URL** (non‑YouTube) or **.txt file** using OpenAI (Romanian supported, no translation).
- 5 imports/day per user with usage tracking (tokens & estimated cost).
- Admin dashboard (password-protected) with per‑day cost/call metrics.
- Ready for **Azure Static Web Apps + Azure Cosmos DB (NoSQL, Serverless)**.

> Frontend is static (`index.html`, `admin.html`). Backend is Azure Functions under `/api` (Node.js ESM).

---

## 1) Repo layout

```
/               # repo root
  index.html
  admin.html
  /api
    package.json
    /shared
    /auth
    /recipes
    /history
    /usage
    /import
    /admin-login
    /admin-metrics
```

---

## 2) Prerequisites

- Azure subscription
- GitHub repo (connected to Azure Static Web Apps)
- OpenAI API key with access to `gpt-4o-mini`
- Azure Cosmos DB account (**NoSQL**, **Serverless**)

Optional (local dev):
- Node 18+
- Azure Functions Core Tools (v4)

---

## 3) Cosmos DB setup

Create a **Cosmos DB for NoSQL** account (Serverless). In **Data Explorer**:

- **Database**: `recipesdb`
- **Containers** (Partition key **`/pk`**, no Unique Keys):
  - `users`
  - `recipes`
  - `history`
  - `usage`

Sample document shapes (for reference):

**users**
```json
{
  "id": "u_am9uZUBtYWlsLmNvbQ",
  "pk": "users",
  "email": "john@mail.com",
  "name": "John",
  "hash": "…bcrypt…",
  "createdAt": "2025-10-19T18:00:00Z"
}
```

**recipes**
```json
{
  "id": "1699999999999",
  "pk": "recipes#u_am9uZUBtYWlsLmNvbQ",
  "uid": "u_am9uZUBtYWlsLmNvbQ",
  "name": "Paste Carbonara",
  "category": "Pasta",
  "ingredients": ["ouă", "guanciale", "pecorino"],
  "instructions": "…",
  "paused": false
}
```

**history**
```json
{
  "id": "u_am9uZUBtYWlsLmNvbQ-2025-10-19-1699999999999",
  "pk": "history#u_am9uZUBtYWlsLmNvbQ",
  "uid": "u_am9uZUBtYWlsLmNvbQ",
  "date": "2025-10-19",
  "recipeId": "1699999999999"
}
```

**usage**
```json
{
  "id": "u_am9uZUBtYWlsLmNvbQ-2025-10-19",
  "pk": "usage",
  "userId": "u_am9uZUBtYWlsLmNvbQ",
  "date": "2025-10-19",
  "calls": 1,
  "input_tokens": 1200,
  "output_tokens": 300,
  "cost_usd": 0.0009
}
```

---

## 4) Azure Static Web Apps (deploy)

1. Push the repo to GitHub with files in place (see layout above).
2. Azure Portal → **Create resource** → **Static Web Apps**.
3. Connect to your GitHub repo/branch.
4. Build details:
   - **App location**: `/`
   - **API location**: `/api`
   - **Output location**: *(leave empty)*
5. Create – Azure generates a GitHub Actions workflow. Every push to the selected branch redeploys the app.

---

## 5) Application settings (SWA → Configuration)

Add the following settings (names must match exactly):

| Name | Value |
|------|-------|
| `COSMOS_CONN_STRING` | Cosmos DB → Keys → **Primary connection string** |
| `COSMOS_DB` | `recipesdb` |
| `COSMOS_COL_USERS` | `users` |
| `COSMOS_COL_USAGE` | `usage` |
| `COSMOS_COL_RECIPES` | `recipes` |
| `COSMOS_COL_HISTORY` | `history` |
| `OPENAI_API_KEY` | your OpenAI key |
| `JWT_SECRET` | long random string (e.g., a GUID) |
| `ADMIN_PASSWORD` | password for the admin dashboard |

> After saving, restart the API from SWA or push a new commit to trigger redeploy.

---

## 6) Using the app

- Navigate to your SWA URL.
- **Register** (email/password) → logged in.
- **Import URL** (non‑YouTube) or **Import .txt** (Romanian content OK; model extracts JSON without translation).
- **Save to list** to persist a parsed recipe.
- Daily **usage counter** appears in the header (5 imports/day limit).
- Admin dashboard: open `/admin.html`, enter `ADMIN_PASSWORD`, choose date, click **Load**.

---

## 7) API overview (Azure Functions)

- `POST /api/auth/register` → `{ email, password }`
- `POST /api/auth/login` → `{ email, password }` (sets `appetora_token` cookie)
- `GET  /api/auth/me` → `{ user }` (if cookie valid)
- `POST /api/auth/logout` → clears cookie

- `GET  /api/recipes` → list current user's recipes
- `POST /api/recipes` → create `{ name, category?, ingredients[], instructions, paused? }`
- `PUT  /api/recipes` → update `{ id, ... }`
- `DELETE /api/recipes?id=...` → delete

- `GET  /api/history?limit=N` → show recent history
- `POST /api/history` → `{ date: "YYYY-MM-DD", recipeId }`

- `GET  /api/usage/today` → `{ calls, input_tokens, output_tokens, cost_usd }`

- `GET  /api/import?url=...` → parse a public recipe page (non‑YouTube)
- `POST /api/import` → `{ text: "..." }` – parse raw text

- `POST /api/admin/login` → `{ password }` → returns admin JWT
- `GET  /api/admin/metrics?date=YYYY-MM-DD` (with `Authorization: Bearer <token>`) → usage per user + totals

---

## 8) Local development (optional)

- Install deps:
  ```bash
  cd api
  npm install
  ```
- Set env vars in a local file (e.g., `local.settings.json` for Functions Core Tools) or your shell:
  ```json
  {
    "IsEncrypted": false,
    "Values": {
      "AzureWebJobsStorage": "UseDevelopmentStorage=true",
      "FUNCTIONS_WORKER_RUNTIME": "node",
      "COSMOS_CONN_STRING": "<your-conn-string>",
      "COSMOS_DB": "recipesdb",
      "COSMOS_COL_USERS": "users",
      "COSMOS_COL_USAGE": "usage",
      "COSMOS_COL_RECIPES": "recipes",
      "COSMOS_COL_HISTORY": "history",
      "OPENAI_API_KEY": "<your-openai-key>",
      "JWT_SECRET": "<random>",
      "ADMIN_PASSWORD": "<admin-pass>"
    }
  }
  ```
- Run functions locally:
  ```bash
  func start
  ```
- Serve the static files (`index.html`, `admin.html`) with any static server (or open directly). Make sure calls hit the local functions base URL (configure a proxy or adjust paths during local testing).

---

## 9) Notes & limits

- **YouTube links are intentionally rejected** in `/api/import` — use regular article/recipe pages or text files.
- Daily limit of **5 imports/user** is enforced and tracked in `usage` container.
- Costs are rough estimates based on `gpt-4o-mini` token pricing — adjust the rates if your model or pricing changes.
- Sessions use an **HttpOnly cookie** (`appetora_token`) signed with `JWT_SECRET`.

---

## 10) Troubleshooting

- **401 on API**: ensure you registered/logged in via the deployed SWA domain (not `file://`), and `JWT_SECRET` is set.
- **Cosmos errors**: verify all containers have **Partition key `/pk`** and **no Unique Keys**.
- **“Daily import limit reached (5)”**: wait until next UTC day or raise the limit in `import/index.js` (`DAILY_LIMIT`).
- **Admin 403**: ensure you call `/api/admin/login` with the correct `ADMIN_PASSWORD` and pass `Authorization: Bearer <token>` to `/api/admin/metrics`.

---

## 11) Security & production tips

- Rotate `JWT_SECRET` & `ADMIN_PASSWORD` periodically.
- Consider adding Email Verification & Password Reset.
- Add rate limiting and request size limits on the import endpoint.
- Use Azure Front Door/WAF if you expect public traffic.
- Consider adding **Unique Key** on `users` container for `/email` if you want to prevent duplicate emails at DB level.

---

Happy cooking! 🍝
