-- Paint vendor stores (optional CC). Rep stays To; store is CC only if the crew picks one.

CREATE TABLE IF NOT EXISTS public.field_tools_vendor_stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.field_tools_vendors(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS field_tools_vendor_stores_vendor_idx
  ON public.field_tools_vendor_stores (vendor_id, active, sort_order);

CREATE UNIQUE INDEX IF NOT EXISTS field_tools_vendor_stores_vendor_email_idx
  ON public.field_tools_vendor_stores (vendor_id, lower(trim(email)));

ALTER TABLE public.field_tools_vendor_stores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS field_tools_vendor_stores_deny ON public.field_tools_vendor_stores;
CREATE POLICY field_tools_vendor_stores_deny ON public.field_tools_vendor_stores
  FOR ALL USING (false) WITH CHECK (false);

INSERT INTO public.field_tools_vendor_stores (vendor_id, name, email, sort_order, active)
SELECT
  v.id,
  CASE
    WHEN lower(trim(v.email_cc)) LIKE 'paf8116@%' THEN 'SF'
    ELSE 'Store'
  END,
  trim(v.email_cc),
  0,
  true
FROM public.field_tools_vendors v
WHERE v.category = 'paint'
  AND trim(coalesce(v.email_cc, '')) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.field_tools_vendor_stores s
    WHERE s.vendor_id = v.id
      AND lower(trim(s.email)) = lower(trim(v.email_cc))
  );

UPDATE public.field_tools_vendors
SET email_cc = '', updated_at = now()
WHERE category = 'paint'
  AND trim(coalesce(email_cc, '')) <> '';

CREATE OR REPLACE FUNCTION public.field_tools_get_order_catalog(
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

  RETURN jsonb_build_object(
    'warehouse_email', coalesce((SELECT s.warehouse_email FROM public.field_tools_order_settings s WHERE s.id = 1), ''),
    'vendors', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id, 'name', v.name, 'email', v.email, 'email_cc', v.email_cc,
        'category', v.category,
        'stores', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', s.id, 'name', s.name, 'email', s.email
          ) ORDER BY s.sort_order, s.name), '[]'::jsonb)
          FROM public.field_tools_vendor_stores s
          WHERE s.vendor_id = v.id AND s.active
        )
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
    'sundries_by_vendor', (
      SELECT coalesce(jsonb_object_agg(vendor_key, cats), '{}'::jsonb)
      FROM (
        SELECT
          ''::text AS vendor_key,
          coalesce((
            SELECT jsonb_object_agg(category, items)
            FROM (
              SELECT c.category, jsonb_agg(c.name ORDER BY c.sort_order, c.name) AS items
              FROM public.field_tools_catalog_items c
              WHERE c.active AND c.section = 'sundry' AND c.category <> ''
                AND NOT EXISTS (
                  SELECT 1 FROM public.field_tools_catalog_item_vendors civ
                  WHERE civ.catalog_item_id = c.id
                )
              GROUP BY c.category
            ) shared
          ), '{}'::jsonb) AS cats
        UNION ALL
        SELECT
          v.name,
          coalesce((
            SELECT jsonb_object_agg(category, items)
            FROM (
              SELECT c.category, jsonb_agg(c.name ORDER BY c.sort_order, c.name) AS items
              FROM public.field_tools_catalog_items c
              JOIN public.field_tools_catalog_item_vendors civ
                ON civ.catalog_item_id = c.id AND civ.vendor_id = v.id
              WHERE c.active AND c.section = 'sundry' AND c.category <> ''
              GROUP BY c.category
            ) assigned
          ), '{}'::jsonb)
        FROM public.field_tools_vendors v
        WHERE v.active AND v.category = 'paint'
      ) x
      WHERE vendor_key = '' OR cats <> '{}'::jsonb
    ),
    'sundry_packages', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'items', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'name', coalesce(c.name, i.item_name),
            'qty', i.default_qty
          ) ORDER BY i.sort_order, coalesce(c.name, i.item_name)), '[]'::jsonb)
          FROM public.field_tools_sundry_package_items i
          LEFT JOIN public.field_tools_catalog_items c ON c.id = i.catalog_item_id
          WHERE i.package_id = p.id
            AND i.catalog_item_id IS NOT NULL
            AND c.active
            AND c.section = 'sundry'
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
    'rental_equipment_by_vendor', (
      SELECT coalesce(jsonb_object_agg(vendor, cats), '{}'::jsonb)
      FROM (
        SELECT vendor, jsonb_object_agg(cat, items) AS cats
        FROM (
          SELECT
            coalesce(c.vendor_name, '') AS vendor,
            c.category AS cat,
            jsonb_agg(c.name ORDER BY c.sort_order, c.name) AS items
          FROM public.field_tools_catalog_items c
          WHERE c.active AND c.section = 'rental_equipment' AND c.category <> ''
          GROUP BY coalesce(c.vendor_name, ''), c.category
        ) t
        GROUP BY vendor
      ) v
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
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_list_vendors(
  p_caller_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);
  RETURN jsonb_build_object(
    'ok', true,
    'vendors', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id, 'name', v.name, 'email', v.email, 'email_cc', v.email_cc,
        'category', v.category, 'sort_order', v.sort_order, 'active', v.active,
        'stores', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', s.id, 'name', s.name, 'email', s.email,
            'sort_order', s.sort_order, 'active', s.active
          ) ORDER BY s.sort_order, s.name), '[]'::jsonb)
          FROM public.field_tools_vendor_stores s
          WHERE s.vendor_id = v.id
        )
      ) ORDER BY v.category, v.sort_order, v.name), '[]'::jsonb)
      FROM public.field_tools_vendors v
    )
  );
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_vendor_store(
  p_caller_id uuid,
  p_session_token text,
  p_store_id uuid,
  p_vendor_id uuid,
  p_name text,
  p_email text,
  p_sort_order integer DEFAULT 0,
  p_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sid uuid;
  store_name text := trim(coalesce(p_name, ''));
  store_email text := trim(coalesce(p_email, ''));
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);
  IF p_vendor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.field_tools_vendors v WHERE v.id = p_vendor_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Vendor not found');
  END IF;
  IF store_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Store name is required');
  END IF;
  IF position('@' in store_email) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Store email is required');
  END IF;
  IF p_store_id IS NULL THEN
    INSERT INTO public.field_tools_vendor_stores (vendor_id, name, email, sort_order, active)
    VALUES (p_vendor_id, store_name, store_email, coalesce(p_sort_order, 0), coalesce(p_active, true))
    RETURNING id INTO sid;
  ELSE
    UPDATE public.field_tools_vendor_stores SET
      vendor_id = p_vendor_id,
      name = store_name,
      email = store_email,
      sort_order = coalesce(p_sort_order, sort_order),
      active = coalesce(p_active, active),
      updated_at = now()
    WHERE id = p_store_id
    RETURNING id INTO sid;
    IF sid IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Store not found');
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', sid);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'error', 'A store with that email already exists for this vendor');
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_delete_vendor_store(
  p_caller_id uuid,
  p_session_token text,
  p_store_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);
  IF p_store_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Store not found');
  END IF;
  DELETE FROM public.field_tools_vendor_stores WHERE id = p_store_id;
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_get_order_catalog(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_list_vendors(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_vendor_store(uuid, text, uuid, uuid, text, text, integer, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_delete_vendor_store(uuid, text, uuid) TO anon, authenticated;
