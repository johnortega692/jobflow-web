-- Paint estimates follow each person's profile switch instead of their role.
-- Admins and supers keep estimates on; foremen, leadmen, and laborers start off until an admin turns it on.

ALTER TABLE public.field_tools_profiles
  ALTER COLUMN show_paint_estimates SET DEFAULT false;

UPDATE public.field_tools_profiles
SET show_paint_estimates = false
WHERE role NOT IN ('admin', 'super');

CREATE OR REPLACE FUNCTION public.field_tools_get_job_paint_estimates(p_caller_id uuid, p_session_token text, p_job_number text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_enabled boolean;
begin
  perform public.field_tools_require_session(p_caller_id, p_session_token);

  if not exists (
    select 1
    from public.field_tools_profiles
    where id = p_caller_id
      and active = true
      and show_paint_estimates
  ) then
    return jsonb_build_object('ok', true, 'visible', false, 'items', '[]'::jsonb);
  end if;

  select coalesce(s.field_show_paint_estimates, false)
  into v_enabled
  from public.field_tools_order_settings s
  where s.id = 1;

  if not coalesce(v_enabled, false) then
    return jsonb_build_object('ok', true, 'visible', false, 'items', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'ok', true,
    'visible', true,
    'items', public.job_paint_estimate_progress(p_job_number),
    'last_min_uncounted', public.job_last_min_uncounted(p_job_number)
  );
end;
$$;

NOTIFY pgrst, 'reload schema';
