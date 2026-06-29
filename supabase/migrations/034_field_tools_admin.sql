-- Field Tools admin: profile phone, vendors, order catalog + admin RPCs

ALTER TABLE public.field_tools_profiles
  ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '';

-- ── Vendors (paint, rental rep, etc.) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.field_tools_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL DEFAULT '',
  email_cc text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'paint' CHECK (category IN ('paint', 'rental')),
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS field_tools_vendors_name_category_idx
  ON public.field_tools_vendors (lower(trim(name)), category);

-- ── Catalog items (products, sundries, equipment, WC, durations) ───────
CREATE TABLE IF NOT EXISTS public.field_tools_catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL CHECK (section IN (
    'paint_product', 'sheen', 'sundry', 'rental_equipment', 'rental_duration',
    'equipment', 'wallcovering', 'haul_off_note'
  )),
  category text NOT NULL DEFAULT '',
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS field_tools_catalog_section_idx
  ON public.field_tools_catalog_items (section, active, sort_order);

ALTER TABLE public.field_tools_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_tools_catalog_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS field_tools_vendors_deny_anon ON public.field_tools_vendors;
CREATE POLICY field_tools_vendors_deny_anon ON public.field_tools_vendors
  FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS field_tools_catalog_deny_anon ON public.field_tools_catalog_items;
CREATE POLICY field_tools_catalog_deny_anon ON public.field_tools_catalog_items
  FOR ALL TO anon USING (false);

-- ── Admin guard ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.field_tools_require_admin(p_caller_id uuid)
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

-- ── Login: include phone ─────────────────────────────────────────────────
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
      'modules', to_jsonb(p.modules)
    )
  );
END;
$$;

-- ── Public catalog read (order forms) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.field_tools_get_order_catalog()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'vendors', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id, 'name', v.name, 'email', v.email, 'email_cc', v.email_cc,
        'category', v.category
      ) ORDER BY v.sort_order, v.name), '[]'::jsonb)
      FROM public.field_tools_vendors v WHERE v.active
    ),
    'paint_products', (
      SELECT coalesce(jsonb_agg(c.name ORDER BY c.sort_order, c.name), '[]'::jsonb)
      FROM public.field_tools_catalog_items c
      WHERE c.active AND c.section = 'paint_product'
    ),
    'sheens', (
      SELECT coalesce(jsonb_agg(c.name ORDER BY c.sort_order, c.name), '[]'::jsonb)
      FROM public.field_tools_catalog_items c
      WHERE c.active AND c.section = 'sheen'
    ),
    'sundries', (
      SELECT coalesce(jsonb_object_agg(cat, items), '{}'::jsonb)
      FROM (
        SELECT c.category AS cat,
          jsonb_agg(c.name ORDER BY c.sort_order, c.name) AS items
        FROM public.field_tools_catalog_items c
        WHERE c.active AND c.section = 'sundry' AND c.category <> ''
        GROUP BY c.category
      ) s
    ),
    'rental_equipment', (
      SELECT coalesce(jsonb_object_agg(cat, items), '{}'::jsonb)
      FROM (
        SELECT c.category AS cat,
          jsonb_agg(c.name ORDER BY c.sort_order, c.name) AS items
        FROM public.field_tools_catalog_items c
        WHERE c.active AND c.section = 'rental_equipment' AND c.category <> ''
        GROUP BY c.category
      ) s
    ),
    'rental_durations', (
      SELECT coalesce(jsonb_agg(c.name ORDER BY c.sort_order, c.name), '[]'::jsonb)
      FROM public.field_tools_catalog_items c
      WHERE c.active AND c.section = 'rental_duration'
    ),
    'equipment', (
      SELECT coalesce(jsonb_agg(c.name ORDER BY c.sort_order, c.name), '[]'::jsonb)
      FROM public.field_tools_catalog_items c
      WHERE c.active AND c.section = 'equipment'
    ),
    'wallcovering', (
      SELECT coalesce(jsonb_object_agg(cat, items), '{}'::jsonb)
      FROM (
        SELECT c.category AS cat,
          jsonb_agg(c.name ORDER BY c.sort_order, c.name) AS items
        FROM public.field_tools_catalog_items c
        WHERE c.active AND c.section = 'wallcovering' AND c.category <> ''
        GROUP BY c.category
      ) s
    ),
    'haul_off_note', (
      SELECT coalesce((SELECT c.name FROM public.field_tools_catalog_items c
        WHERE c.active AND c.section = 'haul_off_note' ORDER BY c.sort_order LIMIT 1), '')
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_get_order_catalog() TO anon, authenticated;

-- ── Admin: profiles ─────────────────────────────────────────────────────
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
        'role', p.role, 'modules', to_jsonb(p.modules), 'active', p.active
      ) ORDER BY p.name), '[]'::jsonb)
      FROM public.field_tools_profiles p
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
  p_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  pid uuid;
  mods text[];
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);

  IF p_name IS NULL OR length(trim(p_name)) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Name is required');
  END IF;

  IF p_role NOT IN ('admin', 'foreman', 'laborer') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid role');
  END IF;

  mods := CASE WHEN p_role = 'admin'
    THEN ARRAY['ordering', 'admin']::text[]
    ELSE ARRAY['ordering']::text[]
  END;

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
      modules = mods,
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

  RETURN jsonb_build_object('ok', true, 'id', pid);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

-- ── Admin: vendors ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.field_tools_admin_list_vendors(p_caller_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);
  RETURN jsonb_build_object(
    'ok', true,
    'vendors', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id, 'name', v.name, 'email', v.email, 'email_cc', v.email_cc,
        'category', v.category, 'sort_order', v.sort_order, 'active', v.active
      ) ORDER BY v.category, v.sort_order, v.name), '[]'::jsonb)
      FROM public.field_tools_vendors v
    )
  );
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_vendor(
  p_caller_id uuid,
  p_vendor_id uuid,
  p_name text,
  p_email text,
  p_email_cc text,
  p_category text,
  p_sort_order integer DEFAULT 0,
  p_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE vid uuid;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);
  IF p_category NOT IN ('paint', 'rental') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid vendor category');
  END IF;
  IF p_vendor_id IS NULL THEN
    INSERT INTO public.field_tools_vendors (name, email, email_cc, category, sort_order, active)
    VALUES (trim(p_name), coalesce(p_email, ''), coalesce(p_email_cc, ''), p_category,
      coalesce(p_sort_order, 0), coalesce(p_active, true))
    RETURNING id INTO vid;
  ELSE
    UPDATE public.field_tools_vendors SET
      name = trim(p_name), email = coalesce(p_email, ''), email_cc = coalesce(p_email_cc, ''),
      category = p_category, sort_order = coalesce(p_sort_order, sort_order),
      active = coalesce(p_active, active), updated_at = now()
    WHERE id = p_vendor_id RETURNING id INTO vid;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', vid);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

-- ── Admin: catalog items ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.field_tools_admin_list_catalog(p_caller_id uuid, p_section text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);
  RETURN jsonb_build_object(
    'ok', true,
    'items', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'section', c.section, 'category', c.category, 'name', c.name,
        'sort_order', c.sort_order, 'active', c.active
      ) ORDER BY c.section, c.category, c.sort_order, c.name), '[]'::jsonb)
      FROM public.field_tools_catalog_items c
      WHERE p_section IS NULL OR c.section = p_section
    )
  );
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_catalog_item(
  p_caller_id uuid,
  p_item_id uuid,
  p_section text,
  p_category text,
  p_name text,
  p_sort_order integer DEFAULT 0,
  p_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE iid uuid;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);
  IF p_item_id IS NULL THEN
    INSERT INTO public.field_tools_catalog_items (section, category, name, sort_order, active)
    VALUES (p_section, coalesce(p_category, ''), trim(p_name), coalesce(p_sort_order, 0), coalesce(p_active, true))
    RETURNING id INTO iid;
  ELSE
    UPDATE public.field_tools_catalog_items SET
      section = coalesce(p_section, section),
      category = coalesce(p_category, category),
      name = trim(p_name),
      sort_order = coalesce(p_sort_order, sort_order),
      active = coalesce(p_active, active),
      updated_at = now()
    WHERE id = p_item_id RETURNING id INTO iid;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', iid);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_delete_catalog_item(
  p_caller_id uuid,
  p_item_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);
  DELETE FROM public.field_tools_catalog_items WHERE id = p_item_id;
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_admin_list_profiles(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_profile(uuid, uuid, text, text, text, text, text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_list_vendors(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_vendor(uuid, uuid, text, text, text, text, integer, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_list_catalog(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_catalog_item(uuid, uuid, text, text, text, integer, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_delete_catalog_item(uuid, uuid) TO anon, authenticated;

-- ── Seed vendors + catalog (from app defaults) ───────────────────────────
INSERT INTO public.field_tools_vendors (name, email, email_cc, category, sort_order)
SELECT v.name, '', '', v.category, v.sort_order
FROM (VALUES
  ('PPG', 'paint', 1),
  ('Sherwin-Williams', 'paint', 2),
  ('Benjamin Moore', 'paint', 3),
  ('Dunn-Edwards', 'paint', 4)
) AS v(name, category, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.field_tools_vendors LIMIT 1);

INSERT INTO public.field_tools_catalog_items (section, category, name, sort_order)
SELECT v.section, v.category, v.name, v.sort_order
FROM (VALUES
  ('paint_product', '', 'ProMar 200', 1),
  ('paint_product', '', 'Duration', 2),
  ('paint_product', '', 'SuperPaint', 3),
  ('paint_product', '', 'Pitt Glaze', 4),
  ('paint_product', '', 'Speedhide', 5),
  ('sheen', '', 'Flat', 1),
  ('sheen', '', 'Eggshell', 2),
  ('sheen', '', 'Satin', 3),
  ('sheen', '', 'Semi-Gloss', 4),
  ('sheen', '', 'Gloss', 5),
  ('sheen', '', 'Primer', 6),
  ('sundry', 'Masking', '1.5" Blue Tape', 1),
  ('sundry', 'Masking', '2" Blue Tape', 2),
  ('sundry', 'Supplies', '9" Roller Cover', 1),
  ('sundry', 'Supplies', '18" Roller Cover', 2),
  ('rental_duration', '', '1 day', 1),
  ('rental_duration', '', '1 week', 2),
  ('rental_duration', '', '2 weeks', 3),
  ('rental_duration', '', 'Custom', 99),
  ('rental_equipment', 'Lifts', 'Scissor Lift 19''', 1),
  ('rental_equipment', 'Lifts', 'Boom Lift 45''', 2),
  ('equipment', '', 'HVLP Sprayer', 1),
  ('equipment', '', 'Airless Sprayer 695', 2),
  ('wallcovering', 'Vinyl', 'Type II Vinyl', 1),
  ('wallcovering', 'Fabric', 'Acoustic Panel Fabric', 1),
  ('haul_off_note', '', 'Include dumpster location, access restrictions, and material types in special instructions.', 1)
) AS v(section, category, name, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.field_tools_catalog_items LIMIT 1);

NOTIFY pgrst, 'reload schema';
