-- JobFlow paint submittals and brush-outs use the Field Tools paint catalog.

CREATE OR REPLACE FUNCTION public.list_field_tools_paint_catalog_for_jobflow()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'products', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'product', c.name,
        'category', c.category,
        'vendor_names', (
          SELECT coalesce(jsonb_agg(v.name ORDER BY v.sort_order, v.name), '[]'::jsonb)
          FROM public.field_tools_catalog_item_vendors civ
          JOIN public.field_tools_vendors v ON v.id = civ.vendor_id
          WHERE civ.catalog_item_id = c.id
        ),
        'sheens', to_jsonb(coalesce(c.sheens, '{}'::text[])),
        'sort_order', c.sort_order
      ) ORDER BY c.category, c.sort_order, c.name), '[]'::jsonb)
      FROM public.field_tools_catalog_items c
      WHERE c.active
        AND c.section = 'paint_product'
        AND public.is_approved_user(auth.uid())
    ),
    'sheens', (
      SELECT coalesce(jsonb_agg(c.name ORDER BY c.sort_order, c.name), '[]'::jsonb)
      FROM public.field_tools_catalog_items c
      WHERE c.active
        AND c.section = 'sheen'
        AND public.is_approved_user(auth.uid())
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.list_field_tools_paint_catalog_for_jobflow() TO authenticated;

COMMENT ON FUNCTION public.list_field_tools_paint_catalog_for_jobflow IS
  'Approved JobFlow users: Field Tools paint products and sheens for submittals and brush-outs.';
