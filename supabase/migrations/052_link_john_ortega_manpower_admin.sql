-- Link John Ortega shared identity to Manpower Cal admin (PIN already in org_people)

INSERT INTO public.manpower_supers (person_id, name, pin_hash, supervisor_label, is_admin, active)
SELECT
  o.id,
  o.name,
  o.pin_hash,
  'John',
  true,
  true
FROM public.org_people o
WHERE lower(trim(o.name)) = 'john ortega'
  AND o.active
  AND NOT EXISTS (
    SELECT 1 FROM public.manpower_supers ms WHERE ms.person_id = o.id
  );
