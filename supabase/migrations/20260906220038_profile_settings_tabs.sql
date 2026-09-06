-- Per-user Settings section visibility (admin-assigned). NULL = all grantable sections.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS settings_tabs text[];

COMMENT ON COLUMN public.profiles.settings_tabs IS
  'Grantable Settings section ids this user may open. NULL means all grantable sections. Admins always see every section.';

DROP FUNCTION IF EXISTS public.list_approved_users();

CREATE FUNCTION public.list_approved_users()
RETURNS TABLE (
  user_id uuid,
  email text,
  job_role text,
  approved_at timestamptz,
  app_role text,
  settings_tabs text[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    u.email::text,
    coalesce(p.job_role, ''),
    p.approved_at,
    p.app_role,
    p.settings_tabs
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.approved_at IS NOT NULL
    AND public.is_app_admin()
  ORDER BY lower(u.email);
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_settings_tabs(
  target_user_id uuid,
  p_settings_tabs text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowed text[] := ARRAY[
    'vendors',
    'delivery',
    'paint-catalog',
    'spec-sections',
    'transmittal-categories',
    'startup-checklist',
    'paint-vendors',
    'email-signature',
    'tracker-schedules',
    'work-orders'
  ];
  cleaned text[];
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT coalesce(array_agg(DISTINCT tab ORDER BY tab), ARRAY[]::text[])
  INTO cleaned
  FROM unnest(coalesce(p_settings_tabs, ARRAY[]::text[])) AS tab
  WHERE tab = ANY (allowed);

  UPDATE public.profiles
  SET settings_tabs = cleaned
  WHERE id = target_user_id
    AND approved_at IS NOT NULL
    AND app_role <> 'admin';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approved non-admin user not found';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_approved_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_settings_tabs(uuid, text[]) TO authenticated;
