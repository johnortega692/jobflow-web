-- Super role: panel access without full admin (no profile edit, kit, or hub links)

ALTER TABLE public.field_tools_profiles
  DROP CONSTRAINT IF EXISTS field_tools_profiles_role_check;

ALTER TABLE public.field_tools_profiles
  ADD CONSTRAINT field_tools_profiles_role_check
  CHECK (role IN ('admin', 'super', 'foreman', 'laborer'));

CREATE OR REPLACE FUNCTION public.field_tools_require_strict_admin(p_caller_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_caller_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.field_tools_profiles
    WHERE id = p_caller_id AND active = true AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_require_admin(p_caller_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_caller_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.field_tools_profiles
    WHERE id = p_caller_id AND active = true AND role IN ('admin', 'super')
  ) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

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
      RETURN ARRAY['ordering', 'admin']::text[];
    END IF;
    RETURN ARRAY['ordering']::text[];
  END IF;

  FOREACH m IN ARRAY p_modules LOOP
    IF m IN ('ordering', 'safety_tailgate', 'daily_report', 'admin') THEN
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

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_profile(
  p_caller_id uuid,
  p_profile_id uuid,
  p_name text,
  p_email text,
  p_phone text,
  p_pin text,
  p_role text,
  p_active boolean DEFAULT true,
  p_modules text[] DEFAULT NULL,
  p_custom_module_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  pid uuid;
  mods text[];
  mid uuid;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);

  IF EXISTS (
    SELECT 1 FROM public.field_tools_profiles
    WHERE id = p_caller_id AND active AND role = 'super'
  ) THEN
    IF p_role = 'admin' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Cannot assign admin role');
    END IF;
    IF p_profile_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.field_tools_profiles
      WHERE id = p_profile_id AND role = 'admin'
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Cannot edit admin profiles');
    END IF;
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Name is required');
  END IF;

  IF p_role NOT IN ('admin', 'super', 'foreman', 'laborer') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid role');
  END IF;

  mods := public.field_tools_sanitize_profile_modules(p_role, p_modules);

  IF p_profile_id IS NULL THEN
    IF p_pin IS NULL OR length(trim(p_pin)) < 4 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'PIN required (4+ digits) for new profile');
    END IF;
    INSERT INTO public.field_tools_profiles (name, email, phone, pin_hash, role, modules, active)
    VALUES (trim(p_name), coalesce(p_email, ''), coalesce(p_phone, ''),
      extensions.crypt(trim(p_pin), extensions.gen_salt('bf')), p_role, mods, coalesce(p_active, true))
    RETURNING id INTO pid;
  ELSE
    UPDATE public.field_tools_profiles SET
      name = trim(p_name),
      email = coalesce(p_email, ''),
      phone = coalesce(p_phone, ''),
      role = p_role,
      modules = CASE
        WHEN p_modules IS NULL THEN modules
        ELSE mods
      END,
      active = coalesce(p_active, active),
      pin_hash = CASE
        WHEN p_pin IS NOT NULL AND length(trim(p_pin)) >= 4
        THEN extensions.crypt(trim(p_pin), extensions.gen_salt('bf'))
        ELSE pin_hash
      END,
      updated_at = now()
    WHERE id = p_profile_id
    RETURNING id INTO pid;
    IF pid IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Profile not found');
    END IF;
  END IF;

  IF p_custom_module_ids IS NOT NULL THEN
    DELETE FROM public.field_tools_profile_custom_modules WHERE profile_id = pid;
    IF array_length(p_custom_module_ids, 1) IS NOT NULL THEN
      FOREACH mid IN ARRAY p_custom_module_ids LOOP
        IF EXISTS (SELECT 1 FROM public.field_tools_custom_modules WHERE id = mid AND active = true) THEN
          INSERT INTO public.field_tools_profile_custom_modules (profile_id, module_id)
          VALUES (pid, mid)
          ON CONFLICT DO NOTHING;
        END IF;
      END LOOP;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', pid);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_list_custom_modules(p_caller_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);
  RETURN jsonb_build_object(
    'ok', true,
    'modules', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'title', m.title, 'description', m.description, 'url', m.url,
        'sort_order', m.sort_order, 'active', m.active
      ) ORDER BY m.sort_order, m.title), '[]'::jsonb)
      FROM public.field_tools_custom_modules m
    )
  );
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_custom_module(
  p_caller_id uuid,
  p_module_id uuid,
  p_title text,
  p_description text,
  p_url text,
  p_sort_order integer DEFAULT 0,
  p_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE mid uuid;
BEGIN
  PERFORM public.field_tools_require_strict_admin(p_caller_id);
  IF p_title IS NULL OR length(trim(p_title)) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Title is required');
  END IF;
  IF p_url IS NULL OR length(trim(p_url)) < 4 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'URL is required');
  END IF;

  IF p_module_id IS NULL THEN
    INSERT INTO public.field_tools_custom_modules (title, description, url, sort_order, active)
    VALUES (trim(p_title), coalesce(p_description, ''), trim(p_url), coalesce(p_sort_order, 0), coalesce(p_active, true))
    RETURNING id INTO mid;
  ELSE
    UPDATE public.field_tools_custom_modules SET
      title = trim(p_title),
      description = coalesce(p_description, ''),
      url = trim(p_url),
      sort_order = coalesce(p_sort_order, sort_order),
      active = coalesce(p_active, active),
      updated_at = now()
    WHERE id = p_module_id
    RETURNING id INTO mid;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', mid);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_delete_custom_module(
  p_caller_id uuid,
  p_module_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_strict_admin(p_caller_id);
  DELETE FROM public.field_tools_custom_modules WHERE id = p_module_id;
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_list_job_scope_kit(p_caller_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_strict_admin(p_caller_id);
  RETURN jsonb_build_object(
    'ok', true,
    'scopes', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'icon', s.icon,
        'color', s.color,
        'sort_order', s.sort_order,
        'active', s.active,
        'materials', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', m.id,
            'catalog_item_id', m.catalog_item_id,
            'name', m.name,
            'unit', m.unit,
            'default_qty', m.default_qty,
            'sort_order', m.sort_order
          ) ORDER BY m.sort_order, m.name), '[]'::jsonb)
          FROM public.field_tools_scope_materials m
          WHERE m.scope_id = s.id
        )
      ) ORDER BY s.sort_order, s.name), '[]'::jsonb)
      FROM public.field_tools_scope_library s
    ),
    'crew_kits', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', k.id,
        'name', k.name,
        'icon', k.icon,
        'color', k.color,
        'sort_order', k.sort_order,
        'active', k.active,
        'items', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', i.id,
            'catalog_item_id', i.catalog_item_id,
            'name', i.name,
            'unit', i.unit,
            'qty_per_man', i.qty_per_man,
            'sort_order', i.sort_order
          ) ORDER BY i.sort_order, i.name), '[]'::jsonb)
          FROM public.field_tools_crew_kit_items i
          WHERE i.crew_kit_id = k.id
        )
      ) ORDER BY k.sort_order, k.name), '[]'::jsonb)
      FROM public.field_tools_crew_kits k
    )
  );
END;
$$;

-- Kit write RPCs: admin only
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
  PERFORM public.field_tools_require_strict_admin(p_caller_id);
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
  PERFORM public.field_tools_require_strict_admin(p_caller_id);
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
  PERFORM public.field_tools_require_strict_admin(p_caller_id);

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
  PERFORM public.field_tools_require_strict_admin(p_caller_id);
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
  PERFORM public.field_tools_require_strict_admin(p_caller_id);

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
  PERFORM public.field_tools_require_strict_admin(p_caller_id);
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
  PERFORM public.field_tools_require_strict_admin(p_caller_id);

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
  PERFORM public.field_tools_require_strict_admin(p_caller_id);
  DELETE FROM public.field_tools_crew_kit_items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Kit item not found.');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

NOTIFY pgrst, 'reload schema';
