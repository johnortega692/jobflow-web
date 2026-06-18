# JobFlow Web — migration roadmap

Desktop JobFlow has 15+ modules. The web app is being ported in phases.

## Live now

| Module | Status |
|--------|--------|
| Auth (email) | Done |
| Projects / Job Info | Done |
| RFIs (full form + print PDF) | Done |
| Submittal Log (basic rows) | Done |
| **Paint submittals** (line items + print PDF) | Done |
| **Wallcovering submittals** (line items + print PDF) | Done |
| **Transmittal** (Ironwood layout + print PDF) | Done |

## Next (recommended order)

1. **Submittal Log** — link rows to paint/WC PDFs, revisions, Excel export
2. **FRP / Track** — submittal & order PDFs
3. **SDS / TDS packet** — PDF bundling
4. **File attachments** — Supabase Storage
5. **Settings** — company letterhead, vendors, products (env vars: `VITE_COMPANY_*`, `VITE_LOGO_URL`, `VITE_SIGNER_*`)
6. **Budget** — Foundation CSV export
8. **Google Sheets / Outlook** — integrations (harder on web)

## Supabase

After pulling updates, run new SQL in the dashboard:

- `supabase/migrations/002_submittals.sql` (if you already ran `schema.sql` before submittals were added)

Or re-run the full `supabase/schema.sql` on a fresh project.
