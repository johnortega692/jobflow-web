-- Point the Field Tools hub Manpower tile at the custom domain.
UPDATE public.field_tools_custom_modules
SET url = 'https://manpower.ortegabuilt.com'
WHERE url ILIKE '%manpower-cal.vercel.app%';
