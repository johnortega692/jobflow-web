# Deploy JobFlow Web (Vercel only)

No Railway, no local API — PDF uses your browser **Print → Save as PDF**.

---

## Step 1 — Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with **GitHub**
2. **Add New → Project** → import **`johnortega692/jobflow-web`**
3. Framework: **Vite** (auto-detected)
4. Add **Environment Variables**:

   | Name | Value |
   |------|--------|
   | `VITE_SUPABASE_URL` | `https://hrbsekijkvhtfoogdwzp.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | from Supabase → Settings → API → **anon public** |
   | `ANTHROPIC_API_KEY` | for **AI paint import** (Anthropic — get at console.anthropic.com) |

   **Vendor email (send from app):**

   | Name | Value |
   |------|--------|
   | `RESEND_API_KEY` | from [resend.com](https://resend.com) → API Keys |
   | `EMAIL_FROM` | `JobFlow <jobflow@ortegabuilt.com>` — domain must be verified in Resend |

   Optional (letterhead on PDF):

   | Name | Value |
   |------|--------|
   | `VITE_COMPANY_NAME` | `Plan B Apps` |
   | `VITE_COMPANY_ADDRESS` | your address |
   | `VITE_COMPANY_PHONE` | your phone |

   **Scheduled tracker emails (Vercel Cron — replaces GAS time triggers):**

   | Name | Value |
   |------|--------|
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → **service_role** (server only — never expose to browser) |
   | `CRON_SECRET` | Random string; Vercel sends `Authorization: Bearer …` on cron hits. Generate with `openssl rand -hex 32` or any password manager. |

   Optional: set `TRACKER_CRON_USER_ID` to a Supabase user UUID to force cron for one account only (otherwise the shared org schedule in **Settings → Paint & email → Scheduled emails** runs using **Notification primary email**).

   Optional: set `GAS_SEND_EMAIL_URL` to the same Field Request Order Apps Script URL used by Field Tools (Supabase edge secret). **Scheduled JobFlow digests send via Resend** using `EMAIL_FROM` (verify `ortegabuilt.com` in Resend, then set `JobFlow <jobflow@ortegabuilt.com>`). Field Request Gmail is the fallback. Field Tools vendor orders still use Gmail `sendOrderEmail`.

   Cron schedule (UTC, configured in `vercel.json`): one job at **15:00 UTC** every day (~8 AM Pacific). That run sends daily follow-ups, plus the weekly digest and site-ready digest on the weekdays chosen in **Settings → Schedules** (defaults Friday and Monday).

5. Click **Deploy**
6. Copy your live URL, e.g. `https://jobflow-web.vercel.app`

---

## Step 2 — Supabase auth (required for login)

Supabase → **Authentication** → [URL Configuration](https://supabase.com/dashboard/project/hrbsekijkvhtfoogdwzp/auth/url-configuration):

- **Site URL**: `https://jobflow-web-kappa.vercel.app` (not localhost — this is the default link in verify/reset emails)
- **Redirect URLs** (allow list), add:
  - `https://jobflow-web-kappa.vercel.app/**`
  - `http://localhost:5173/**` (local Vite)
  - optional Vercel previews: `https://*-johnortega692.vercel.app/**` (adjust team slug if different)

Signup code also passes `emailRedirectTo` to the live app so confirm links do not fall back to localhost when Site URL was left on a local default.
---

## Step 3 — Test

1. Open your Vercel URL
2. Sign in
3. Open a project → RFI → **Print / Save PDF**
4. In the print dialog, choose **Save as PDF** → Save

---

## Updating the app later

```powershell
Set-Location "D:\Plan B\Apps\JOBFLOW\jobflow-web"
git add .
git commit -m "describe your change"
git push
```

Vercel redeploys automatically.

---

## Local dev

```powershell
Set-Location "D:\Plan B\Apps\JOBFLOW\jobflow-web"
.\dev.bat
```

Add to `.env.local` for **Send email** in dev:

```
RESEND_API_KEY=re_...
EMAIL_FROM=JobFlow <jobflow@ortegabuilt.com>
```

Only **one** terminal needed. PDF works via browser print — no `api\dev.bat`.

---

## Optional logo

Put `logo.png` in a `public` folder, set `VITE_LOGO_URL=/logo.png` on Vercel, redeploy.
