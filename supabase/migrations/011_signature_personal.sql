-- Email signature is per-user (not org-wide). Remove legacy copy from org_settings blob.

update public.org_settings
set
  settings = settings - 'signature',
  updated_at = now()
where id = 1
  and settings ? 'signature';
