-- Remove dev seed Field Tools profiles with known weak PINs (Daniel, David Tenorio).

DELETE FROM public.field_tools_profiles ftp
WHERE lower(trim(ftp.name)) IN ('daniel', 'david tenorio');

DELETE FROM public.org_people o
WHERE lower(trim(o.name)) IN ('daniel', 'david tenorio')
  AND NOT EXISTS (
    SELECT 1 FROM public.field_tools_profiles ftp WHERE ftp.person_id = o.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.manpower_supers ms WHERE ms.person_id = o.id
  );
