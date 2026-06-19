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
   | `EMAIL_FROM` | `Your Name <noreply@yourdomain.com>` — domain must be verified in Resend |

   Optional (letterhead on PDF):

   | Name | Value |
   |------|--------|
   | `VITE_COMPANY_NAME` | `Plan B Apps` |
   | `VITE_COMPANY_ADDRESS` | your address |
   | `VITE_COMPANY_PHONE` | your phone |

5. Click **Deploy**
6. Copy your live URL, e.g. `https://jobflow-web.vercel.app`

---

## Step 2 — Supabase auth (required for login)

Supabase → **Authentication** → **URL Configuration**:

- **Site URL**: `https://your-app.vercel.app`
- **Redirect URLs**: add `https://your-app.vercel.app/**`

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
EMAIL_FROM=John Ortega <noreply@yourdomain.com>
```

Only **one** terminal needed. PDF works via browser print — no `api\dev.bat`.

---

## Optional logo

Put `logo.png` in a `public` folder, set `VITE_LOGO_URL=/logo.png` on Vercel, redeploy.
