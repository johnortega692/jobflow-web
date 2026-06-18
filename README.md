# JobFlow Web

React + Supabase starter for moving JobFlow (and related apps) to the browser.

## Quick start

### 1. Supabase setup

1. Open your Supabase project → **SQL Editor**
2. Run the full script in [`supabase/schema.sql`](supabase/schema.sql)
3. **Authentication → Providers** → enable **Email**
4. **Project Settings → API** → copy **Project URL** and **anon public** key

### 2. Local env

```bash
cd jobflow-web
copy .env.example .env.local
```

Edit `.env.local`:

```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

## Run

### Terminal 1 — web app
```bash
cd jobflow-web
npm.cmd install
npm.cmd run dev
```
Open http://localhost:5173

### Terminal 2 — PDF API (Export PDF button)
Double-click `api\dev.bat` or:
```bash
cd jobflow-web\api
dev.bat
```
API runs at http://localhost:8765 — uses desktop `rfi_template.html` + WeasyPrint (same as JobFlow.exe).

## Export RFI PDF

1. Open an RFI → fill subject + question → **Save RFI**
2. Click **Export PDF** (API must be running in terminal 2)
3. PDF downloads — same layout as desktop RFI Maker

## Deploy to Vercel (web UI — no install for users)

**Full step-by-step:** see [`DEPLOY.md`](DEPLOY.md)

1. Push `jobflow-web` to GitHub
2. Deploy **PDF API first** on [Railway](https://railway.app) (root: `api`, uses Dockerfile)
3. Deploy **web UI** on [Vercel](https://vercel.com) with env vars:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_API_URL` = your Railway URL
4. Set Railway `CORS_ORIGINS` to your Vercel URL
5. Add Vercel URL to Supabase **Authentication → URL Configuration**

## What's included

- Email auth (sign up / sign in)
- **Projects** table (job number, name, address, contacts)
- **RFIs** table with `data` jsonb (desktop RFI field shape)
- Dark UI shell matching JobFlow direction

## Next steps (planned)

- AI assist for RFI wording
- Submittal / SDS modules
- Tighter RLS per organization

## Folder layout

```text
jobflow-web/
  api/              # FastAPI + WeasyPrint PDF export
  src/
    pages/          # Login, projects, RFI editor
    lib/supabase.ts # Supabase client
    lib/api.ts      # PDF export client
  supabase/
    schema.sql      # Run once in Supabase dashboard
  vercel.json       # SPA routing for Vercel deploy
```
