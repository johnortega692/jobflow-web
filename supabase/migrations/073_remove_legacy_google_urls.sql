-- Drop retired Google Apps Script URL keys (brush-outs → Supabase; manpower → Supabase RPCs).
UPDATE public.org_settings
SET google_urls = google_urls - 'brushouts_tracker' - 'manpower_schedule'
WHERE id = 1;
