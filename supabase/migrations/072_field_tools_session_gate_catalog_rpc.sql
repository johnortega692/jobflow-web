-- Require a valid Field Tools session for catalog, brushouts, and PO preview RPCs.

DROP FUNCTION IF EXISTS public.field_tools_get_order_catalog();
DROP FUNCTION IF EXISTS public.field_tools_get_approved_brushouts(text);
DROP FUNCTION IF EXISTS public.field_tools_preview_po_numbers(text, integer);

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

CREATE OR REPLACE FUNCTION public.field_tools_get_approved_brushouts(
  p_caller_id uuid,
  p_session_token text,
  p_job_number text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean text;
  v_vendor text;
  v_colors jsonb;
  v_items jsonb;
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);

  v_clean := split_part(trim(coalesce(p_job_number, '')), ' ', 1);
  IF v_clean = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Job number is required');
  END IF;

  SELECT coalesce(max(b.paint_vendor) FILTER (WHERE b.approved), '')
  INTO v_vendor
  FROM public.project_approved_brushouts b
  WHERE split_part(trim(b.job_number), ' ', 1) = v_clean
     OR lower(trim(b.job_number)) = lower(trim(p_job_number));

  SELECT coalesce(
    jsonb_agg(b.display_line ORDER BY b.sort_order, b.display_line)
      FILTER (WHERE b.approved AND b.display_line <> ''),
    '[]'::jsonb
  )
  INTO v_colors
  FROM public.project_approved_brushouts b
  WHERE (split_part(trim(b.job_number), ' ', 1) = v_clean
     OR lower(trim(b.job_number)) = lower(trim(p_job_number)))
    AND b.approved;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', b.id,
        'display_line', b.display_line,
        'color', b.color,
        'product', b.product,
        'sheen', b.sheen,
        'label', b.label,
        'floor', b.floor,
        'paint_vendor', b.paint_vendor
      )
      ORDER BY b.sort_order, b.display_line
    )
    FILTER (WHERE b.approved),
    '[]'::jsonb
  )
  INTO v_items
  FROM public.project_approved_brushouts b
  WHERE (split_part(trim(b.job_number), ' ', 1) = v_clean
     OR lower(trim(b.job_number)) = lower(trim(p_job_number)))
    AND b.approved;

  RETURN jsonb_build_object(
    'ok', true,
    'job_number', v_clean,
    'paint_vendor', coalesce(v_vendor, ''),
    'colors', coalesce(v_colors, '[]'::jsonb),
    'items', coalesce(v_items, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_preview_po_numbers(
  p_caller_id uuid,
  p_session_token text,
  p_job_code text,
  p_count integer DEFAULT 1
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clean text;
  digits integer;
  highest integer;
  admin_next integer;
  seq integer;
  i integer;
  n integer;
  out text[] := '{}';
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);

  n := greatest(coalesce(p_count, 1), 0);
  IF n = 0 THEN
    RETURN out;
  END IF;

  clean := public.field_tools_po_normalize_job_code(p_job_code);

  SELECT coalesce(s.po_seq_digits, 3) INTO digits
  FROM public.field_tools_order_settings s
  WHERE s.id = 1;

  highest := public.field_tools_po_highest_issued(clean);

  SELECT j.next_seq INTO admin_next
  FROM public.field_tools_po_job_sequences j
  WHERE j.job_code = clean;

  IF admin_next IS NOT NULL THEN
    seq := greatest(admin_next, highest + 1);
  ELSE
    seq := highest + 1;
  END IF;

  FOR i IN 0..(n - 1) LOOP
    out := array_append(out, clean || '-' || lpad((seq + i)::text, digits, '0'));
  END LOOP;

  RETURN out;
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_get_order_catalog(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_get_approved_brushouts(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_preview_po_numbers(uuid, text, text, integer) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
