-- Field Tools: per-user module access, custom URL hub links, catalog reorder

-- ── Custom hub link modules ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.field_tools_custom_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  url text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.field_tools_profile_custom_modules (
  profile_id uuid NOT NULL REFERENCES public.field_tools_profiles(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES public.field_tools_custom_modules(id) ON DELETE CASCADE,
  PRIMARY KEY (profile_id, module_id)
);

CREATE INDEX IF NOT EXISTS field_tools_profile_custom_modules_profile_idx
  ON public.field_tools_profile_custom_modules (profile_id);

ALTER TABLE public.field_tools_custom_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_tools_profile_custom_modules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS field_tools_custom_modules_deny_anon ON public.field_tools_custom_modules;
CREATE POLICY field_tools_custom_modules_deny_anon ON public.field_tools_custom_modules
  FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS field_tools_profile_custom_modules_deny_anon ON public.field_tools_profile_custom_modules;
CREATE POLICY field_tools_profile_custom_modules_deny_anon ON public.field_tools_profile_custom_modules
  FOR ALL TO anon USING (false);

-- ── Login: include custom hub links ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.field_tools_login_pin(p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  p public.field_tools_profiles%ROWTYPE;
  match_count integer;
BEGIN
  SELECT count(*)::integer INTO match_count
  FROM public.field_tools_profiles
  WHERE active = true
    AND pin_hash IS NOT NULL
    AND pin_hash = crypt(trim(p_pin), pin_hash);

  IF match_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid PIN');
  END IF;

  IF match_count > 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PIN is not unique — contact admin');
  END IF;

  SELECT * INTO p
  FROM public.field_tools_profiles
  WHERE active = true
    AND pin_hash IS NOT NULL
    AND pin_hash = crypt(trim(p_pin), pin_hash);

  RETURN jsonb_build_object(
    'ok', true,
    'profile', jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'email', p.email,
      'phone', p.phone,
      'role', p.role,
      'modules', to_jsonb(p.modules),
      'custom_modules', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'id', cm.id,
          'title', cm.title,
          'description', cm.description,
          'url', cm.url,
          'sort_order', cm.sort_order
        ) ORDER BY cm.sort_order, cm.title), '[]'::jsonb)
        FROM public.field_tools_profile_custom_modules pcm
        JOIN public.field_tools_custom_modules cm ON cm.id = pcm.module_id
        WHERE pcm.profile_id = p.id AND cm.active = true
      )
    )
  );
END;
$$;

-- ── Admin: profiles (module assignment) ─────────────────────────────────
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
    )
  );
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
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
    IF p_role = 'admin' THEN
      RETURN ARRAY['ordering', 'admin']::text[];
    END IF;
    RETURN ARRAY['ordering']::text[];
  END IF;

  FOREACH m IN ARRAY p_modules LOOP
    IF m IN ('ordering', 'safety_tailgate', 'daily_report', 'admin') THEN
      IF m = 'admin' AND p_role <> 'admin' THEN
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

  IF p_name IS NULL OR length(trim(p_name)) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Name is required');
  END IF;

  IF p_role NOT IN ('admin', 'foreman', 'laborer') THEN
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

-- ── Admin: custom hub modules ───────────────────────────────────────────
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
  PERFORM public.field_tools_require_admin(p_caller_id);
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
  PERFORM public.field_tools_require_admin(p_caller_id);
  DELETE FROM public.field_tools_custom_modules WHERE id = p_module_id;
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

-- ── Admin: catalog reorder ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.field_tools_admin_reorder_catalog(
  p_caller_id uuid,
  p_section text,
  p_category text,
  p_item_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  i integer;
  iid uuid;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);

  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No items to reorder');
  END IF;

  i := 0;
  FOREACH iid IN ARRAY p_item_ids LOOP
    i := i + 1;
    UPDATE public.field_tools_catalog_items SET
      sort_order = i,
      updated_at = now()
    WHERE id = iid
      AND section = p_section
      AND coalesce(category, '') = coalesce(p_category, '');
  END LOOP;

  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_profile(uuid, uuid, text, text, text, text, text, boolean, text[], uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_list_custom_modules(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_custom_module(uuid, uuid, text, text, text, integer, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_delete_custom_module(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_reorder_catalog(uuid, text, text, uuid[]) TO anon, authenticated;
