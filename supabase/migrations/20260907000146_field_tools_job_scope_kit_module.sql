-- Job Scope Kit as its own hub module, assignable per profile.

CREATE OR REPLACE FUNCTION public.field_tools_sanitize_profile_modules(p_role text, p_modules text[])
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  allowed text[] := ARRAY[]::text[];
  m text;
BEGIN
  IF p_modules IS NULL THEN
    IF p_role IN ('admin', 'super') THEN
      RETURN ARRAY['ordering', 'job_scope_kit', 'field_view', 'safety_tailgate', 'admin']::text[];
    END IF;
    RETURN ARRAY['ordering', 'job_scope_kit', 'field_view', 'safety_tailgate']::text[];
  END IF;

  FOREACH m IN ARRAY p_modules LOOP
    IF m IN ('ordering', 'job_scope_kit', 'field_view', 'safety_tailgate', 'daily_report', 'admin') THEN
      IF m = 'admin' AND p_role NOT IN ('admin', 'super') THEN
        CONTINUE;
      END IF;
      IF NOT (m = ANY(allowed)) THEN
        allowed := array_append(allowed, m);
      END IF;
    END IF;
  END LOOP;

  IF array_length(allowed, 1) IS NULL THEN
    allowed := ARRAY['ordering']::text[];
  END IF;

  RETURN allowed;
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_default_hub_module_order()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY['ordering', 'job_scope_kit', 'field_view', 'safety_tailgate', 'daily_report']::text[];
$$;

UPDATE public.field_tools_profiles
SET modules = array_append(modules, 'job_scope_kit')
WHERE ('ordering' = ANY (modules))
  AND NOT ('job_scope_kit' = ANY (modules));

DO $$
DECLARE
  v_order text[];
  v_next text[] := ARRAY[]::text[];
  k text;
  inserted boolean := false;
BEGIN
  SELECT hub_module_order INTO v_order
  FROM public.field_tools_order_settings
  WHERE id = 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_order IS NULL THEN
    UPDATE public.field_tools_order_settings
    SET hub_module_order = public.field_tools_default_hub_module_order(),
        updated_at = now()
    WHERE id = 1;
    RETURN;
  END IF;

  IF 'job_scope_kit' = ANY (v_order) THEN
    RETURN;
  END IF;

  FOREACH k IN ARRAY v_order LOOP
    v_next := array_append(v_next, k);
    IF k = 'ordering' THEN
      v_next := array_append(v_next, 'job_scope_kit');
      inserted := true;
    END IF;
  END LOOP;

  IF NOT inserted THEN
    v_next := array_prepend('job_scope_kit', v_next);
  END IF;

  UPDATE public.field_tools_order_settings
  SET hub_module_order = v_next,
      updated_at = now()
  WHERE id = 1;
END;
$$;
