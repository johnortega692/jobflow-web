-- Extra work can pick an employee name from the Manpower calendar crew list.

CREATE OR REPLACE FUNCTION public.field_tools_list_manpower_workers(
  p_caller_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);

  IF NOT EXISTS (
    SELECT 1 FROM public.field_tools_profiles
    WHERE id = p_caller_id AND active = true
      AND 'extra_work' = ANY (coalesce(modules, '{}'::text[]))
  ) THEN
    RAISE EXCEPTION 'Extra work tags are not turned on for this profile.' USING ERRCODE = 'P0001';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(
      jsonb_build_object('id', e.id, 'name', btrim(e.name))
      ORDER BY e.sort_order, lower(btrim(e.name)), e.id
    )
    FROM public.manpower_employees e
    WHERE e.active AND btrim(e.name) <> ''
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.field_tools_list_manpower_workers(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.field_tools_list_manpower_workers(uuid, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
