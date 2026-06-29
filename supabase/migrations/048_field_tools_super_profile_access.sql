-- Super users can manage profiles but cannot see or edit admin accounts

CREATE OR REPLACE FUNCTION public.field_tools_admin_list_profiles(p_caller_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);
  RETURN jsonb_build_object(
    'ok', true,
    'profiles', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'email', p.email, 'phone', p.phone,
        'role', p.role, 'modules', to_jsonb(p.modules), 'active', p.active,
        'custom_module_ids', (
          SELECT coalesce(jsonb_agg(pcm.module_id ORDER BY cm.sort_order, cm.title), '[]'::jsonb)
          FROM public.field_tools_profile_custom_modules pcm
          JOIN public.field_tools_custom_modules cm ON cm.id = pcm.module_id
          WHERE pcm.profile_id = p.id
        )
      ) ORDER BY p.name), '[]'::jsonb)
      FROM public.field_tools_profiles p
      WHERE NOT (
        EXISTS (
          SELECT 1 FROM public.field_tools_profiles c
          WHERE c.id = p_caller_id AND c.active AND c.role = 'super'
        )
        AND p.role = 'admin'
      )
    )
  );
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
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

-- Super needs read access to hub links when assigning them on profiles
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

NOTIFY pgrst, 'reload schema';
