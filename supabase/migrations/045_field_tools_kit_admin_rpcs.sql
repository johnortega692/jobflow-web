-- Remaining Job Scope Kit admin RPCs (companion to 044)

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_scope(
  p_caller_id uuid,
  p_scope_id uuid,
  p_name text,
  p_icon text,
  p_color text,
  p_sort_order integer,
  p_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_name text := trim(coalesce(p_name, ''));
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);
  IF v_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Scope name is required.');
  END IF;

  IF p_scope_id IS NULL THEN
    INSERT INTO public.field_tools_scope_library (name, icon, color, sort_order, active)
    VALUES (v_name, coalesce(p_icon, ''), coalesce(nullif(trim(p_color), ''), '#2f81f7'), coalesce(p_sort_order, 0), coalesce(p_active, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.field_tools_scope_library
    SET name = v_name,
        icon = coalesce(p_icon, icon),
        color = coalesce(nullif(trim(p_color), ''), color),
        sort_order = coalesce(p_sort_order, sort_order),
        active = coalesce(p_active, active)
    WHERE id = p_scope_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Scope not found.');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_delete_scope(p_caller_id uuid, p_scope_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);
  UPDATE public.field_tools_scope_library SET active = false WHERE id = p_scope_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Scope not found.');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_scope_material(
  p_caller_id uuid,
  p_material_id uuid,
  p_scope_id uuid,
  p_catalog_item_id uuid,
  p_default_qty numeric,
  p_unit text,
  p_sort_order integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_name text;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);

  IF p_scope_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Scope is required.');
  END IF;

  SELECT c.name INTO v_name
  FROM public.field_tools_catalog_items c
  WHERE c.id = p_catalog_item_id AND c.section = 'sundry' AND c.active;

  IF v_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Select an active sundry from the catalog.');
  END IF;

  IF p_material_id IS NULL THEN
    INSERT INTO public.field_tools_scope_materials (scope_id, catalog_item_id, name, unit, default_qty, sort_order)
    VALUES (
      p_scope_id,
      p_catalog_item_id,
      v_name,
      coalesce(nullif(trim(p_unit), ''), 'ea'),
      greatest(coalesce(p_default_qty, 1), 0.001),
      coalesce(p_sort_order, 0)
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.field_tools_scope_materials
    SET catalog_item_id = p_catalog_item_id,
        name = v_name,
        unit = coalesce(nullif(trim(p_unit), ''), unit),
        default_qty = greatest(coalesce(p_default_qty, default_qty), 0.001),
        sort_order = coalesce(p_sort_order, sort_order)
    WHERE id = p_material_id AND scope_id = p_scope_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Material not found.');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_delete_scope_material(p_caller_id uuid, p_material_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);
  DELETE FROM public.field_tools_scope_materials WHERE id = p_material_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Material not found.');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_crew_kit(
  p_caller_id uuid,
  p_kit_id uuid,
  p_name text,
  p_icon text,
  p_color text,
  p_sort_order integer,
  p_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_name text := trim(coalesce(p_name, ''));
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);

  IF v_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Crew kit name is required.');
  END IF;

  IF p_kit_id IS NULL THEN
    INSERT INTO public.field_tools_crew_kits (name, icon, color, sort_order, active)
    VALUES (v_name, coalesce(p_icon, ''), coalesce(nullif(trim(p_color), ''), '#2f81f7'), coalesce(p_sort_order, 0), coalesce(p_active, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.field_tools_crew_kits
    SET name = v_name,
        icon = coalesce(p_icon, icon),
        color = coalesce(nullif(trim(p_color), ''), color),
        sort_order = coalesce(p_sort_order, sort_order),
        active = coalesce(p_active, active)
    WHERE id = p_kit_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Crew kit not found.');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_delete_crew_kit(p_caller_id uuid, p_kit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);
  UPDATE public.field_tools_crew_kits SET active = false WHERE id = p_kit_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Crew kit not found.');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_crew_kit_item(
  p_caller_id uuid,
  p_item_id uuid,
  p_crew_kit_id uuid,
  p_catalog_item_id uuid,
  p_qty_per_man numeric,
  p_unit text,
  p_sort_order integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_name text;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);

  IF p_crew_kit_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Crew kit is required.');
  END IF;

  SELECT c.name INTO v_name
  FROM public.field_tools_catalog_items c
  WHERE c.id = p_catalog_item_id AND c.section = 'sundry' AND c.active;

  IF v_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Select an active sundry from the catalog.');
  END IF;

  IF p_item_id IS NULL THEN
    INSERT INTO public.field_tools_crew_kit_items (crew_kit_id, catalog_item_id, name, unit, qty_per_man, sort_order)
    VALUES (
      p_crew_kit_id,
      p_catalog_item_id,
      v_name,
      coalesce(nullif(trim(p_unit), ''), 'ea'),
      greatest(coalesce(p_qty_per_man, 1), 0.001),
      coalesce(p_sort_order, 0)
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.field_tools_crew_kit_items
    SET catalog_item_id = p_catalog_item_id,
        name = v_name,
        unit = coalesce(nullif(trim(p_unit), ''), unit),
        qty_per_man = greatest(coalesce(p_qty_per_man, qty_per_man), 0.001),
        sort_order = coalesce(p_sort_order, sort_order)
    WHERE id = p_item_id AND crew_kit_id = p_crew_kit_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Kit item not found.');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_delete_crew_kit_item(p_caller_id uuid, p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);
  DELETE FROM public.field_tools_crew_kit_items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Kit item not found.');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_scope(uuid, uuid, text, text, text, integer, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_delete_scope(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_scope_material(uuid, uuid, uuid, uuid, numeric, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_delete_scope_material(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_crew_kit(uuid, uuid, text, text, text, integer, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_delete_crew_kit(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_crew_kit_item(uuid, uuid, uuid, uuid, numeric, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_delete_crew_kit_item(uuid, uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
