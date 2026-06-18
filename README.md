# JobFlow Web

React + Supabase app for JobFlow in the browser.

## Quick start

### 1. Supabase

1. Run [`supabase/schema.sql`](supabase/schema.sql) in Supabase **SQL Editor**
2. Enable **Email** auth
3. Copy **Project URL** and **anon** key

### 2. Local env

```powershell
Set-Location "D:\Plan B\Apps\JOBFLOW\jobflow-web"
Copy-Item .env.example .env.local
```

Edit `.env.local` with your Supabase keys.

### 3. Run

```powershell
.\dev.bat
```

Open http://localhost:5173

## Print / Save PDF

Open an RFI → **Print / Save PDF** → in the print dialog choose **Save as PDF**.

No separate API server needed.

## Deploy (Vercel)

See [`DEPLOY.md`](DEPLOY.md) — about 5 minutes, Vercel + Supabase only.

## What's included

- Email auth
- Projects + RFIs (Supabase)
- Browser PDF (same RFI layout as desktop)

## Folder layout

```text
jobflow-web/
  src/pages/       Login, projects, RFI editor
  src/lib/         Supabase client, print/PDF
  supabase/        schema.sql
  api/             (optional — local WeasyPrint API, not needed for deploy)
```
