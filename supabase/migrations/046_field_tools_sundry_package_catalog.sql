-- Link sundry package line items to catalog (sundry section)

ALTER TABLE public.field_tools_sundry_package_items
  ADD COLUMN IF NOT EXISTS catalog_item_id uuid REFERENCES public.field_tools_catalog_items (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS field_tools_sundry_package_items_catalog_idx
  ON public.field_tools_sundry_package_items (catalog_item_id);

UPDATE public.field_tools_sundry_package_items i
SET catalog_item_id = c.id
FROM public.field_tools_catalog_items c
WHERE i.catalog_item_id IS NULL
  AND c.section = 'sundry'
  AND c.active
  AND lower(trim(c.name)) = lower(trim(i.item_name));

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
            'catalog_item_id', i.catalog_item_id,
            'name', coalesce(c.name, i.item_name),
            'qty', i.default_qty,
            'sort_order', i.sort_order
          ) ORDER BY i.sort_order, coalesce(c.name, i.item_name)), '[]'::jsonb)
          FROM public.field_tools_sundry_package_items i
          LEFT JOIN public.field_tools_catalog_items c ON c.id = i.catalog_item_id
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
  v_catalog_id uuid;
  v_item_name text;
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
      v_catalog_id := nullif(trim(item->>'catalog_item_id'), '')::uuid;
      IF v_catalog_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Each line item must be selected from the sundry catalog.');
      END IF;

      SELECT c.name INTO v_item_name
      FROM public.field_tools_catalog_items c
      WHERE c.id = v_catalog_id AND c.section = 'sundry' AND c.active;

      IF v_item_name IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Invalid or inactive catalog item.');
      END IF;

      INSERT INTO public.field_tools_sundry_package_items (
        package_id, catalog_item_id, item_name, default_qty, sort_order
      )
      VALUES (
        v_id,
        v_catalog_id,
        v_item_name,
        greatest(coalesce((item->>'qty')::numeric, 1), 0.001),
        coalesce((item->>'sort_order')::integer, idx)
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

NOTIFY pgrst, 'reload schema';
