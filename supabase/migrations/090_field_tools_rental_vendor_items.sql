-- Associate rental catalog items with a rental vendor.
-- Empty vendor_name means the item is available to every rental vendor.

ALTER TABLE public.field_tools_catalog_items
  ADD COLUMN IF NOT EXISTS vendor_name text NOT NULL DEFAULT '';

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

CREATE OR REPLACE FUNCTION public.field_tools_admin_list_catalog(
  p_caller_id uuid,
  p_session_token text,
  p_section text DEFAULT NULL
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
    'items', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'section', c.section, 'category', c.category, 'name', c.name,
        'vendor_name', coalesce(c.vendor_name, ''),
        'sort_order', c.sort_order, 'active', c.active
      ) ORDER BY c.section, c.vendor_name, c.category, c.sort_order, c.name), '[]'::jsonb)
      FROM public.field_tools_catalog_items c
      WHERE p_section IS NULL OR c.section = p_section
    )
  );
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

DROP FUNCTION IF EXISTS public.field_tools_admin_upsert_catalog_item(uuid, text, uuid, text, text, text, integer, boolean);

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_catalog_item(
  p_caller_id uuid,
  p_session_token text,
  p_item_id uuid,
  p_section text,
  p_category text,
  p_name text,
  p_sort_order integer DEFAULT 0,
  p_active boolean DEFAULT true,
  p_vendor_name text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE iid uuid;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);
  IF p_item_id IS NULL THEN
    INSERT INTO public.field_tools_catalog_items (section, category, name, sort_order, active, vendor_name)
    VALUES (
      p_section,
      coalesce(p_category, ''),
      trim(p_name),
      coalesce(p_sort_order, 0),
      coalesce(p_active, true),
      CASE WHEN p_section = 'rental_equipment' THEN trim(coalesce(p_vendor_name, '')) ELSE '' END
    )
    RETURNING id INTO iid;
  ELSE
    UPDATE public.field_tools_catalog_items SET
      section = coalesce(p_section, section),
      category = coalesce(p_category, category),
      name = trim(p_name),
      sort_order = coalesce(p_sort_order, sort_order),
      active = coalesce(p_active, active),
      vendor_name = CASE
        WHEN coalesce(p_section, section) = 'rental_equipment' THEN trim(coalesce(p_vendor_name, ''))
        ELSE ''
      END,
      updated_at = now()
    WHERE id = p_item_id RETURNING id INTO iid;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', iid);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_get_order_catalog(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_list_catalog(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_catalog_item(uuid, text, uuid, text, text, text, integer, boolean, text) TO anon, authenticated;
