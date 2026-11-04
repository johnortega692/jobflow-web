-- Per-person switch for paint estimates on the Field Request. Admins set it in Field Tools Admin → Profiles.
-- Estimates still need an admin or super role and the company-wide Paint estimates setting.

ALTER TABLE public.field_tools_profiles
  ADD COLUMN IF NOT EXISTS show_paint_estimates boolean NOT NULL DEFAULT true;

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
      and role in ('admin', 'super')
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

CREATE OR REPLACE FUNCTION public.field_tools_admin_list_profiles(p_caller_id uuid, p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
begin
  perform public.field_tools_require_admin(p_caller_id, p_session_token);
  return jsonb_build_object(
    'ok', true,
    'profiles', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'email', p.email, 'phone', p.phone,
        'role', p.role, 'modules', to_jsonb(p.modules), 'active', p.active,
        'job_access', p.job_access,
        'show_paint_estimates', p.show_paint_estimates,
        'projects', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', pr.id,
            'job_number', pr.job_number,
            'job_name', pr.job_name
          ) order by pr.job_number), '[]'::jsonb)
          from public.field_tools_project_access a
          join public.projects pr on pr.id = a.project_id
          where a.profile_id = p.id
        ),
        'custom_module_ids', (
          select coalesce(jsonb_agg(pcm.module_id order by cm.sort_order, cm.title), '[]'::jsonb)
          from public.field_tools_profile_custom_modules pcm
          join public.field_tools_custom_modules cm on cm.id = pcm.module_id
          where pcm.profile_id = p.id
        )
      ) order by p.name), '[]'::jsonb)
      from public.field_tools_profiles p
      where not exists (
        select 1 from public.field_tools_safety_pins s where s.profile_id = p.id
      )
      and not (
        exists (
          select 1 from public.field_tools_profiles c
          where c.id = p_caller_id and c.active and c.role = 'super'
        )
        and p.role = 'admin'
      )
    )
  );
exception when sqlstate 'P0001' then
  return jsonb_build_object('ok', false, 'error', 'Admin access required');
end;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_set_profile_paint_estimates(
  p_caller_id uuid,
  p_session_token text,
  p_profile_id uuid,
  p_show boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_id uuid;
begin
  perform public.field_tools_require_admin(p_caller_id, p_session_token);

  if exists (
    select 1 from public.field_tools_profiles c
    where c.id = p_caller_id and c.active and c.role = 'super'
  ) and exists (
    select 1 from public.field_tools_profiles t
    where t.id = p_profile_id and t.role = 'admin'
  ) then
    return jsonb_build_object('ok', false, 'error', 'Admin access required');
  end if;

  update public.field_tools_profiles
  set show_paint_estimates = coalesce(p_show, true),
      updated_at = now()
  where id = p_profile_id
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'Profile not found');
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'show_paint_estimates', coalesce(p_show, true));
exception when sqlstate 'P0001' then
  return jsonb_build_object('ok', false, 'error', 'Admin access required');
end;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_admin_set_profile_paint_estimates(uuid, text, uuid, boolean) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
