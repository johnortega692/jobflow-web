-- Ironwood paint products by vendor (from Products sheet)
-- category column = vendor name; run after 034 + 035

DELETE FROM public.field_tools_catalog_items WHERE section = 'paint_product';

UPDATE public.field_tools_vendors SET name = 'PPG Paints' WHERE category = 'paint' AND lower(trim(name)) IN ('ppg', 'ppg paints');
UPDATE public.field_tools_vendors SET name = 'Dunn Edwards' WHERE category = 'paint' AND lower(trim(name)) IN ('dunn-edwards', 'dunn edwards');
UPDATE public.field_tools_vendors SET name = 'Sherwin Williams' WHERE category = 'paint' AND lower(trim(name)) IN ('sherwin-williams', 'sherwin williams');

INSERT INTO public.field_tools_vendors (name, email, email_cc, category, sort_order)
SELECT v.name, '', '', 'paint', v.sort_order
FROM (VALUES
  ('PPG Paints', 1),
  ('Dunn Edwards', 2),
  ('Vista Paints', 3),
  ('Benjamin Moore', 4),
  ('Sherwin Williams', 5),
  ('BEHR', 6)
) AS v(name, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.field_tools_vendors fv
  WHERE fv.category = 'paint' AND lower(trim(fv.name)) = lower(trim(v.name))
);

INSERT INTO public.field_tools_catalog_items (section, category, name, sort_order)
SELECT 'paint_product', v.vendor, v.name, v.sort_order
FROM (VALUES
  -- PPG Paints
  ('PPG Paints', 'PPG Speed Hide', 1),
  ('PPG Paints', 'PPG Speed Hide Zero', 2),
  ('PPG Paints', 'PPG Pure Performance', 3),
  ('PPG Paints', 'PPG Speedhide Dry Fog', 4),
  ('PPG Paints', 'PPG Pre Cat Epoxy', 5),
  ('PPG Paints', 'PPG Pitt Tech DTM Finish', 6),
  ('PPG Paints', 'PPG Pitt Tech DTM Primer', 7),
  ('PPG Paints', 'PPG Speedhide Ext', 8),
  ('PPG Paints', 'PPG Sun Proof Ext', 9),
  ('PPG Paints', 'PPG Break-Through', 10),
  ('PPG Paints', 'PPG Perma-Crete Elastomeric', 11),
  ('PPG Paints', 'PPG Seal Grip', 12),
  ('PPG Paints', 'Roman Pro-880', 13),
  ('PPG Paints', 'Roman Clay 111', 14),
  ('PPG Paints', 'Zinsser 1-2-3', 15),
  ('PPG Paints', 'Zinsser Gardz', 16),
  ('PPG Paints', 'Insl-X Stix Waterborne Bonding', 17),
  ('PPG Paints', 'Amerlock 2 part epoxy', 18),
  ('PPG Paints', 'XIM-UMA bonding primer', 19),
  ('PPG Paints', '3.5 gal. Liquid Nails (FRP) Adhesive', 20),
  -- Dunn Edwards
  ('Dunn Edwards', 'DE SpartaWall', 1),
  ('Dunn Edwards', 'DE Spartashield Ext', 2),
  ('Dunn Edwards', 'DE Vinylastic Plus - PVA', 3),
  ('Dunn Edwards', 'DE AQUAFALL', 4),
  ('Dunn Edwards', 'DE Block-it', 5),
  ('Dunn Edwards', 'DE Bloc-Rust DTM Primer', 6),
  ('Dunn Edwards', 'DE EFF-STOP Masonry', 7),
  ('Dunn Edwards', 'DE Smooth Blocfil', 8),
  ('Dunn Edwards', 'DE Ultra-Grip Select', 9),
  ('Dunn Edwards', 'DE EnduraPrime -DTM Primer', 10),
  ('Dunn Edwards', 'DE Endura-Coat DTM Finish', 11),
  ('Dunn Edwards', 'DE Enduracat pre-cat', 12),
  ('Dunn Edwards', 'Zinsser 1-2-3', 13),
  ('Dunn Edwards', 'Zinsser Gardz', 14),
  -- Vista Paints
  ('Vista Paints', 'Uniprime', 1),
  ('Vista Paints', 'Seal Kote PVA', 2),
  ('Vista Paints', 'Terminator II', 3),
  ('Vista Paints', 'V-Pro', 4),
  ('Vista Paints', 'Primer Bin', 5),
  ('Vista Paints', 'Primer Cover Stain', 6),
  ('Vista Paints', 'Roman Pro-880', 7),
  ('Vista Paints', 'Roman Clay 111', 8),
  ('Vista Paints', 'Zinsser 1-2-3', 9),
  ('Vista Paints', 'Zinsser Gardz', 10),
  -- Benjamin Moore
  ('Benjamin Moore', 'BM CorondaoPVA', 1),
  ('Benjamin Moore', 'BM SuperHide Int', 2),
  ('Benjamin Moore', 'BM Ultra Spec 500 Int', 3),
  ('Benjamin Moore', 'BM Ultra Spec HP DTM', 4),
  ('Benjamin Moore', 'BM Ecospec', 5),
  ('Benjamin Moore', 'BM Dryfall', 6),
  ('Benjamin Moore', 'BM Insl-X Prime All', 7),
  ('Benjamin Moore', 'BM Insl-X Stix Bonding', 8),
  ('Benjamin Moore', 'Pre-catalyzed, waterborne acrylic epoxy', 9),
  ('Benjamin Moore', 'BM Aura', 10),
  -- Sherwin Williams
  ('Sherwin Williams', 'SW DTM Wash', 1),
  ('Sherwin Williams', 'SW Pro Cryl', 2),
  ('Sherwin Williams', 'SW Promar 200', 3),
  ('Sherwin Williams', 'SW PVA', 4),
  ('Sherwin Williams', 'SW Sher Cryl', 5),
  ('Sherwin Williams', 'SW Waterbase Dryfall', 6),
  ('Sherwin Williams', 'SW Superpaint AirPur', 7),
  ('Sherwin Williams', 'SW Exteme Bond', 8),
  ('Sherwin Williams', 'SW DTM Acrylic', 9),
  ('Sherwin Williams', 'SW Superpaint Ext', 10),
  ('Sherwin Williams', 'SW A100', 11),
  ('Sherwin Williams', 'Roman Pro-880', 12),
  ('Sherwin Williams', 'Roman Clay 111', 13),
  ('Sherwin Williams', 'Zinsser 1-2-3', 14),
  ('Sherwin Williams', 'Zinsser Gardz', 15),
  ('Sherwin Williams', 'Minwax Varnish', 16),
  ('Sherwin Williams', 'SW Scuff Tuff', 17),
  ('Sherwin Williams', 'Zinsser Peel Stop', 18),
  ('Sherwin Williams', 'SW PrimeRX', 19),
  -- BEHR
  ('BEHR', 'BEHR Premium Plus Int', 1),
  ('BEHR', 'BEHR PVA Primer', 2),
  ('BEHR', 'BEHR I300', 3),
  ('BEHR', 'BEHR DTM', 4),
  ('BEHR', 'BEHR Metal Primer', 5),
  ('BEHR', 'BEHR Multi Surface Primer', 6)
) AS v(vendor, name, sort_order);

-- Return paint products grouped by vendor (category)
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

NOTIFY pgrst, 'reload schema';
