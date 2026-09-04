-- Hide jobs marked hidden_from_field_apps from Field View dashboards
-- (Paint, Wallcovering, Calendar, Workload). Labor projection already filtered.

CREATE OR REPLACE FUNCTION public.field_view_list_projects(
  p_caller_id uuid DEFAULT NULL,
  p_session_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ft_profile uuid;
BEGIN
  PERFORM public.field_view_require_access(p_caller_id, p_session_token);
  v_ft_profile := public.field_tools_valid_session_profile_id(p_caller_id, p_session_token);

  RETURN coalesce((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'job_number', p.job_number,
        'job_name', p.job_name,
        'job_address', p.job_address,
        'job_address2', p.job_address2,
        'contractor', p.contractor,
        'architect', p.architect,
        'owner', p.owner,
        'organization_id', p.organization_id,
        'data', public.field_view_strip_project_data(p.data),
        'created_at', p.created_at,
        'updated_at', p.updated_at,
        'created_by', p.created_by,
        'updated_by', p.updated_by
      )
      ORDER BY p.job_number
    )
    FROM public.projects p
    WHERE NOT public.project_hidden_from_field_apps(p.id)
      AND (
        v_ft_profile IS NULL
        OR public.field_tools_profile_can_access_project(v_ft_profile, p.id)
      )
  ), '[]'::jsonb);
END;
$$;
