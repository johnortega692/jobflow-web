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
      SELECT coalesce(jsonb_object_agg(vendor_key, items), '{}'::jsonb)
      FROM (
        SELECT
          ''::text AS vendor_key,
          coalesce((
            SELECT jsonb_agg(c.name ORDER BY c.sort_order, c.name)
            FROM public.field_tools_catalog_items c
            WHERE c.active AND c.section = 'paint_product'
              AND NOT EXISTS (
                SELECT 1 FROM public.field_tools_catalog_item_vendors civ
                WHERE civ.catalog_item_id = c.id
              )
          ), '[]'::jsonb) AS items
        UNION ALL
        SELECT
          v.name,
          coalesce((
            SELECT jsonb_agg(c.name ORDER BY c.sort_order, c.name)
            FROM public.field_tools_catalog_items c
            JOIN public.field_tools_catalog_item_vendors civ
              ON civ.catalog_item_id = c.id AND civ.vendor_id = v.id
            WHERE c.active AND c.section = 'paint_product'
          ), '[]'::jsonb)
        FROM public.field_tools_vendors v
        WHERE v.active AND v.category = 'paint'
      ) x
      WHERE vendor_key = '' OR items <> '[]'::jsonb
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
