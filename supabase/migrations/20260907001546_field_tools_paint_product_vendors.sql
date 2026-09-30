-- Paint products can belong to many paint vendors (or none = every vendor).

INSERT INTO public.field_tools_catalog_item_vendors (catalog_item_id, vendor_id)
SELECT c.id, v.id
FROM public.field_tools_catalog_items c
JOIN public.field_tools_vendors v
  ON v.category = 'paint'
 AND lower(trim(v.name)) = lower(trim(c.category))
WHERE c.section = 'paint_product'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_catalog_item(
  p_caller_id uuid,
  p_session_token text,
  p_item_id uuid,
  p_section text,
  p_category text,
  p_name text,
  p_sort_order integer DEFAULT 0,
  p_active boolean DEFAULT true,
  p_vendor_name text DEFAULT '',
  p_vendor_names text[] DEFAULT NULL
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

  IF iid IS NOT NULL AND p_section IN ('sundry', 'paint_product') THEN
    IF p_vendor_names IS NOT NULL THEN
      DELETE FROM public.field_tools_catalog_item_vendors WHERE catalog_item_id = iid;
      INSERT INTO public.field_tools_catalog_item_vendors (catalog_item_id, vendor_id)
      SELECT DISTINCT iid, v.id
      FROM public.field_tools_vendors v
      WHERE v.category = 'paint'
        AND v.name = ANY (p_vendor_names);
    END IF;
  ELSIF iid IS NOT NULL THEN
    DELETE FROM public.field_tools_catalog_item_vendors WHERE catalog_item_id = iid;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', iid);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;
