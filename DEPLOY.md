# JobFlow Web — deploy to Vercel + Railway

Deploy the **web UI** to Vercel and the **PDF API** to Railway. Users only need the Vercel link in a browser.

---

## Before you start

1. A **GitHub** account
2. **Vercel** — sign in with GitHub at [vercel.com](https://vercel.com)
3. **Railway** — sign in with GitHub at [railway.app](https://railway.app)
4. Your Supabase keys (already in `.env.local`)

---

## Step 1 — Push to GitHub

Open **Command Prompt** in `D:\Plan B\Apps\JOBFLOW\jobflow-web`:

```bat
cd /d "D:\Plan B\Apps\JOBFLOW\jobflow-web"
git init
git add .
git commit -m "JobFlow web app — ready for Vercel + Railway"
```

On GitHub: **New repository** → name it `jobflow-web` → **do not** add README/license.

Then:

```bat
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/jobflow-web.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username.

---

## Step 2 — Deploy PDF API on Railway (do this first)

You need the API URL before setting Vercel env vars.

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Select `jobflow-web`
3. **Settings** → **Root Directory** → set to: `api`
4. Railway should detect the **Dockerfile** automatically
5. **Variables** → add:

   | Name | Value |
   |------|--------|
   | `CORS_ORIGINS` | `https://YOUR-APP.vercel.app` *(update after Vercel deploy)* |
   | `JOBFLOW_COMPANY_NAME` | `Plan B Apps` *(optional)* |

6. **Settings** → **Networking** → **Generate Domain**
7. Copy the public URL, e.g. `https://jobflow-api-production.up.railway.app`
8. Test: open `https://YOUR-RAILWAY-URL/health` — should show `"ok": true`

---

## Step 3 — Deploy web UI on Vercel

1. [vercel.com](https://vercel.com) → **Add New** → **Project**
2. Import `jobflow-web` from GitHub
3. **Root Directory** → `jobflow-web` (or leave default if repo root *is* jobflow-web)
4. Framework: **Vite** (auto-detected)
5. **Environment Variables**:

   | Name | Value |
   |------|--------|
   | `VITE_SUPABASE_URL` | `https://hrbsekijkvhtfoogdwzp.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | *(from Supabase → Settings → API → anon key)* |
   | `VITE_API_URL` | `https://YOUR-RAILWAY-URL` *(no trailing slash)* |

6. **Deploy**
7. Copy your Vercel URL, e.g. `https://jobflow-web.vercel.app`

---

## Step 4 — Connect CORS (Railway ↔ Vercel)

Back in **Railway** → your API service → **Variables**:

```
CORS_ORIGINS=https://jobflow-web.vercel.app
```

Use your real Vercel URL. Railway will redeploy automatically.

---

## Step 5 — Test at work

1. Open your Vercel URL
2. Sign in (same account as local)
3. Open a project → RFI → **Export PDF**

No install, no local API — PDF runs on Railway.

---

## Supabase auth redirect (if login fails on Vercel)

Supabase → **Authentication** → **URL Configuration**:

- **Site URL**: your Vercel URL
- **Redirect URLs**: add `https://your-app.vercel.app/**`

---

## Optional — company logo on PDFs

Put `logo.png` or `companylogo.png` in `jobflow-web/api/assets/`, commit, and redeploy Railway.

---

## Local dev (unchanged)

| Terminal | Command |
|----------|---------|
| Web | `jobflow-web\dev.bat` |
| PDF API | `jobflow-web\api\dev.bat` |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Export PDF: "API is not running" | Check `VITE_API_URL` on Vercel matches Railway URL; redeploy Vercel after changing env vars |
| CORS / Failed to fetch | Update `CORS_ORIGINS` on Railway with exact Vercel URL |
| Railway build fails | Ensure root directory is `api` and Dockerfile is present |
| `/health` shows `template: false` | `rfi_template.html` missing from `api/` — re-commit and push |
| Login redirect error | Add Vercel URL to Supabase redirect URLs |
