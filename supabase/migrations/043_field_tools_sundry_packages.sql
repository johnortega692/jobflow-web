-- Sundry custom packages (Cut-In Setup, Job Startup, 1/2 Man Setup) for Field Request orders

CREATE TABLE IF NOT EXISTS public.field_tools_sundry_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS field_tools_sundry_packages_name_active_uidx
  ON public.field_tools_sundry_packages (lower(trim(name)))
  WHERE active;

CREATE TABLE IF NOT EXISTS public.field_tools_sundry_package_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.field_tools_sundry_packages (id) ON DELETE CASCADE,
  item_name text NOT NULL,
  default_qty numeric NOT NULL DEFAULT 1 CHECK (default_qty > 0),
  sort_order integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS field_tools_sundry_package_items_package_idx
  ON public.field_tools_sundry_package_items (package_id, sort_order);

ALTER TABLE public.field_tools_sundry_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_tools_sundry_package_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS field_tools_sundry_packages_anon_read ON public.field_tools_sundry_packages;
CREATE POLICY field_tools_sundry_packages_anon_read ON public.field_tools_sundry_packages
  FOR SELECT TO anon, authenticated USING (active);

DROP POLICY IF EXISTS field_tools_sundry_package_items_anon_read ON public.field_tools_sundry_package_items;
CREATE POLICY field_tools_sundry_package_items_anon_read ON public.field_tools_sundry_package_items
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.field_tools_sundry_packages p
      WHERE p.id = package_id AND p.active
    )
  );

-- Seed legacy GAS custom packages (item names match Ironwood sundry catalog)
INSERT INTO public.field_tools_sundry_packages (name, sort_order)
SELECT v.name, v.sort_order
FROM (VALUES
  ('Cut-In Setup', 1),
  ('Job Startup Small', 2),
  ('1 Man Setup', 3),
  ('2 Man Setup', 4)
) AS v(name, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.field_tools_sundry_packages LIMIT 1);

INSERT INTO public.field_tools_sundry_package_items (package_id, item_name, default_qty, sort_order)
SELECT p.id, i.item_name, i.default_qty, i.sort_order
FROM public.field_tools_sundry_packages p
JOIN (VALUES
  ('Cut-In Setup', '2Gal Pail', 1, 1),
  ('Cut-In Setup', '2Gal Grid', 1, 2),
  ('Cut-In Setup', '7in Mini Frame', 1, 3),
  ('Cut-In Setup', '6in Roller No Button End 1/2 Nap 12Pk', 1, 4),
  ('Job Startup Small', '5Gal Pail', 1, 1),
  ('Job Startup Small', 'White Tape 1 1/2', 5, 2),
  ('Job Startup Small', 'Masking Film 99', 3, 3),
  ('Job Startup Small', 'Poly Red Tape', 2, 4),
  ('Job Startup Small', 'Strainer Bags Elastic Top Reg Mesh 5gal', 5, 5),
  ('Job Startup Small', 'Rags 8LBS', 1, 6),
  ('Job Startup Small', 'Full Circle Radius 150 Grit', 2, 7),
  ('Job Startup Small', '9in Roller Frame Quick release', 2, 8),
  ('Job Startup Small', '9in 50/50 Blend 3/4 Nap', 2, 9),
  ('1 Man Setup', '2Gal Pail', 1, 1),
  ('1 Man Setup', '5Gal Pail', 1, 2),
  ('1 Man Setup', '2Gal Grid', 2, 3),
  ('1 Man Setup', '5Gal Grid', 2, 4),
  ('1 Man Setup', '7in Mini Frame', 1, 5),
  ('1 Man Setup', '9in Roller Frame Quick release', 1, 6),
  ('1 Man Setup', '6in Roller No Button End 1/2 Nap 12Pk', 2, 7),
  ('1 Man Setup', '9in 50/50 Blend 3/4 Nap', 2, 8),
  ('1 Man Setup', 'Crawfords Spackle', 1, 9),
  ('1 Man Setup', 'USG Easy Sand 5 3lbs', 1, 10),
  ('1 Man Setup', 'Dual Grit Sanding Sponge', 2, 11),
  ('2 Man Setup', '2Gal Pail', 2, 1),
  ('2 Man Setup', '5Gal Pail', 2, 2),
  ('2 Man Setup', '2Gal Grid', 4, 3),
  ('2 Man Setup', '5Gal Grid', 4, 4),
  ('2 Man Setup', '7in Mini Frame', 2, 5),
  ('2 Man Setup', '9in Roller Frame Quick release', 2, 6),
  ('2 Man Setup', '6in Roller No Button End 1/2 Nap 12Pk', 4, 7),
  ('2 Man Setup', '9in 50/50 Blend 3/4 Nap', 4, 8),
  ('2 Man Setup', 'Crawfords Spackle', 2, 9),
  ('2 Man Setup', 'USG Easy Sand 5 3lbs', 2, 10),
  ('2 Man Setup', 'Dual Grit Sanding Sponge', 4, 11)
) AS i(package_name, item_name, default_qty, sort_order)
  ON lower(trim(p.name)) = lower(trim(i.package_name))
WHERE NOT EXISTS (SELECT 1 FROM public.field_tools_sundry_package_items LIMIT 1);

CREATE OR REPLACE FUNCTION public.field_tools_get_order_catalog()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'warehouse_email', coalesce((SELECT s.warehouse_email FROM public.field_tools_order_settings s WHERE s.id = 1), ''),
    'vendors', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id, 'name', v.name, 'email', v.email, 'email_cc', v.email_cc,
        'category', v.category
      ) ORDER BY v.sort_order, v.name), '[]'::jsonb)
      FROM public.field_tools_vendors v WHERE v.active
    ),
    'paint_products_by_vendor', (
      SELECT coalesce(jsonb_object_agg(vendor, items), '{}'::jsonb)
      FROM (
        SELECT c.category AS vendor,
          jsonb_agg(c.name ORDER BY c.sort_order, c.name) AS items
        FROM public.field_tools_catalog_items c
        WHERE c.active AND c.section = 'paint_product' AND c.category <> ''
        GROUP BY c.category
      ) p
    ),
    'paint_products', (
      SELECT coalesce(jsonb_agg(c.name ORDER BY c.category, c.sort_order, c.name), '[]'::jsonb)
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
    'sundry_packages', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'items', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'name', i.item_name,
            'qty', i.default_qty
          ) ORDER BY i.sort_order, i.item_name), '[]'::jsonb)
          FROM public.field_tools_sundry_package_items i
          WHERE i.package_id = p.id
        )
      ) ORDER BY p.sort_order, p.name), '[]'::jsonb)
      FROM public.field_tools_sundry_packages p
      WHERE p.active
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

CREATE OR REPLACE FUNCTION public.field_tools_admin_list_sundry_packages(p_caller_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);
  RETURN jsonb_build_object(
    'ok', true,
    'packages', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'sort_order', p.sort_order,
        'active', p.active,
        'items', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', i.id,
            'name', i.item_name,
            'qty', i.default_qty,
            'sort_order', i.sort_order
          ) ORDER BY i.sort_order, i.item_name), '[]'::jsonb)
          FROM public.field_tools_sundry_package_items i
          WHERE i.package_id = p.id
        )
      ) ORDER BY p.sort_order, p.name), '[]'::jsonb)
      FROM public.field_tools_sundry_packages p
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_sundry_package(
  p_caller_id uuid,
  p_package_id uuid,
  p_name text,
  p_sort_order integer,
  p_active boolean,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_name text := trim(coalesce(p_name, ''));
  item jsonb;
  idx integer := 0;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);

  IF v_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Package name is required.');
  END IF;

  IF p_package_id IS NULL THEN
    INSERT INTO public.field_tools_sundry_packages (name, sort_order, active, updated_at)
    VALUES (v_name, coalesce(p_sort_order, 0), coalesce(p_active, true), now())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.field_tools_sundry_packages
    SET name = v_name,
        sort_order = coalesce(p_sort_order, sort_order),
        active = coalesce(p_active, active),
        updated_at = now()
    WHERE id = p_package_id
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Package not found.');
    END IF;

    DELETE FROM public.field_tools_sundry_package_items WHERE package_id = v_id;
  END IF;

  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' THEN
    FOR item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
      idx := idx + 1;
      IF trim(coalesce(item->>'name', '')) = '' THEN
        CONTINUE;
      END IF;
      INSERT INTO public.field_tools_sundry_package_items (package_id, item_name, default_qty, sort_order)
      VALUES (
        v_id,
        trim(item->>'name'),
        greatest(coalesce((item->>'qty')::numeric, 1), 0.001),
        coalesce((item->>'sort_order')::integer, idx)
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_delete_sundry_package(
  p_caller_id uuid,
  p_package_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);

  UPDATE public.field_tools_sundry_packages
  SET active = false, updated_at = now()
  WHERE id = p_package_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Package not found.');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_admin_list_sundry_packages(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_sundry_package(uuid, uuid, text, integer, boolean, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_delete_sundry_package(uuid, uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
