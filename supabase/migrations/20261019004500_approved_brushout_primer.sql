-- Approved brush-outs store the finish catalog row and the primer resolved for that line.
-- Primer rule matches src/lib/paintCatalog.ts effectivePaintPrimer:
-- primer_override_id, else the catalog paired_primer_id, else none.
-- 'none' or no pair → self_priming, primer columns null.
-- A catalog product that is itself a primer is not self-priming.
--
-- Rollback for the is_primer data fix:
--   UPDATE public.field_tools_catalog_items c
--   SET is_primer = b.previous_is_primer
--   FROM public.field_tools_paint_is_primer_revert b
--   WHERE c.id = b.catalog_item_id;
--   DROP TABLE public.field_tools_paint_is_primer_revert;

ALTER TABLE public.project_approved_brushouts
  ADD COLUMN IF NOT EXISTS catalog_item_id uuid,
  ADD COLUMN IF NOT EXISTS primer_catalog_id uuid,
  ADD COLUMN IF NOT EXISTS primer_name text,
  ADD COLUMN IF NOT EXISTS self_priming boolean;

ALTER TABLE public.project_approved_brushouts
  ALTER COLUMN self_priming SET DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_approved_brushouts_catalog_item_id_fkey'
  ) THEN
    ALTER TABLE public.project_approved_brushouts
      ADD CONSTRAINT project_approved_brushouts_catalog_item_id_fkey
      FOREIGN KEY (catalog_item_id)
      REFERENCES public.field_tools_catalog_items (id)
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_approved_brushouts_primer_catalog_id_fkey'
  ) THEN
    ALTER TABLE public.project_approved_brushouts
      ADD CONSTRAINT project_approved_brushouts_primer_catalog_id_fkey
      FOREIGN KEY (primer_catalog_id)
      REFERENCES public.field_tools_catalog_items (id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.project_approved_brushouts.catalog_item_id IS
  'Catalog paint product for this brush-out line. Null when the product name did not match.';
COMMENT ON COLUMN public.project_approved_brushouts.primer_catalog_id IS
  'Resolved primer catalog row. Null when self-priming or unmatched.';
COMMENT ON COLUMN public.project_approved_brushouts.primer_name IS
  'Resolved primer name. Null when self-priming or unmatched.';
COMMENT ON COLUMN public.project_approved_brushouts.self_priming IS
  'True when the finish override is none or the catalog product has no pair. Null when this row was not matched to a paint submittal item.';

CREATE OR REPLACE FUNCTION public.paint_manufacturer_key(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(btrim(coalesce(p_value, '')))
    WHEN 'de' THEN 'de'
    WHEN 'dunn edwards' THEN 'de'
    WHEN 'dunn-edwards' THEN 'de'
    WHEN 'sw' THEN 'sw'
    WHEN 'sherwin williams' THEN 'sw'
    WHEN 'sherwin-williams' THEN 'sw'
    WHEN 'ppg' THEN 'ppg'
    WHEN 'ppg paints' THEN 'ppg'
    WHEN 'bm' THEN 'bm'
    WHEN 'benjamin moore' THEN 'bm'
    WHEN 'behr' THEN 'behr'
    WHEN 'vista' THEN 'vista'
    WHEN 'vista paints' THEN 'vista'
    ELSE lower(btrim(coalesce(p_value, '')))
  END;
$$;

-- Same rule as JobFlow effectivePaintPrimer in src/lib/paintCatalog.ts.
CREATE OR REPLACE FUNCTION public.resolve_job_paint_primer(
  p_product text,
  p_manufacturer text,
  p_primer_override_id text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_name text := lower(btrim(coalesce(p_product, '')));
  v_mfr text := public.paint_manufacturer_key(p_manufacturer);
  v_override text := btrim(coalesce(p_primer_override_id, ''));
  v_item uuid;
  v_is_primer boolean;
  v_paired uuid;
  v_primer uuid;
  v_primer_name text;
BEGIN
  IF v_name = '' THEN
    RETURN jsonb_build_object('matched', false);
  END IF;

  SELECT c.id, coalesce(c.is_primer, false), c.paired_primer_id
  INTO v_item, v_is_primer, v_paired
  FROM public.field_tools_catalog_items c
  LEFT JOIN public.field_tools_catalog_item_vendors civ ON civ.catalog_item_id = c.id
  LEFT JOIN public.field_tools_vendors v ON v.id = civ.vendor_id
  WHERE c.active
    AND c.section = 'paint_product'
    AND lower(btrim(c.name)) = v_name
  ORDER BY
    CASE
      WHEN v_mfr <> '' AND public.paint_manufacturer_key(coalesce(v.name, c.category)) = v_mfr THEN 0
      WHEN v_mfr = '' THEN 1
      ELSE 2
    END,
    c.sort_order,
    c.name
  LIMIT 1;

  IF v_item IS NULL THEN
    RETURN jsonb_build_object('matched', false);
  END IF;

  IF v_is_primer THEN
    RETURN jsonb_build_object(
      'matched', true,
      'catalog_item_id', v_item,
      'primer_catalog_id', NULL,
      'primer_name', NULL,
      'self_priming', false
    );
  END IF;

  IF lower(v_override) = 'none' THEN
    RETURN jsonb_build_object(
      'matched', true,
      'catalog_item_id', v_item,
      'primer_catalog_id', NULL,
      'primer_name', NULL,
      'self_priming', true
    );
  END IF;

  IF v_override ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT p.id, p.name
    INTO v_primer, v_primer_name
    FROM public.field_tools_catalog_items p
    WHERE p.id = v_override::uuid
      AND p.section = 'paint_product'
      AND coalesce(p.is_primer, false);
  END IF;

  IF v_primer IS NULL AND v_paired IS NOT NULL THEN
    SELECT p.id, p.name
    INTO v_primer, v_primer_name
    FROM public.field_tools_catalog_items p
    WHERE p.id = v_paired
      AND p.section = 'paint_product'
      AND coalesce(p.is_primer, false);
  END IF;

  IF v_primer IS NULL THEN
    RETURN jsonb_build_object(
      'matched', true,
      'catalog_item_id', v_item,
      'primer_catalog_id', NULL,
      'primer_name', NULL,
      'self_priming', true
    );
  END IF;

  RETURN jsonb_build_object(
    'matched', true,
    'catalog_item_id', v_item,
    'primer_catalog_id', v_primer,
    'primer_name', v_primer_name,
    'self_priming', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.paint_manufacturer_key(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_job_paint_primer(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.paint_manufacturer_key(text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_job_paint_primer(text, text, text) FROM anon, authenticated;

-- Primer flag before backfill so a paired primer whose only marker was the Primer sheen still resolves.
-- Rows already true are left alone.
-- Rollback:
--   UPDATE public.field_tools_catalog_items c
--   SET is_primer = b.previous_is_primer
--   FROM public.field_tools_paint_is_primer_revert b
--   WHERE c.id = b.catalog_item_id;
--   DROP TABLE public.field_tools_paint_is_primer_revert;
CREATE TABLE IF NOT EXISTS public.field_tools_paint_is_primer_revert (
  catalog_item_id uuid PRIMARY KEY,
  previous_is_primer boolean NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.field_tools_paint_is_primer_revert ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.field_tools_paint_is_primer_revert FROM PUBLIC, anon, authenticated;

INSERT INTO public.field_tools_paint_is_primer_revert (catalog_item_id, previous_is_primer)
SELECT c.id, c.is_primer
FROM public.field_tools_catalog_items c
WHERE c.section = 'paint_product'
  AND c.is_primer = false
  AND EXISTS (
    SELECT 1
    FROM unnest(coalesce(c.sheens, '{}'::text[])) AS sheen
    WHERE lower(btrim(sheen)) = 'primer'
  )
ON CONFLICT (catalog_item_id) DO NOTHING;

UPDATE public.field_tools_catalog_items c
SET is_primer = true
FROM public.field_tools_paint_is_primer_revert b
WHERE c.id = b.catalog_item_id
  AND c.is_primer = false;

-- Backfill approved rows from the job's paint submittal. Unmatched rows stay null.
WITH items AS (
  SELECT
    p.id AS project_id,
    btrim(item->>'label') AS label,
    btrim(item->>'product') AS product,
    btrim(coalesce(item->>'manufacturer', '')) AS manufacturer,
    nullif(btrim(coalesce(item->>'primer_override_id', '')), '') AS primer_override_id
  FROM public.projects p
  CROSS JOIN LATERAL jsonb_array_elements(
    coalesce(p.data->'paint_submittal'->'items', '[]'::jsonb)
  ) AS item
  WHERE btrim(coalesce(item->>'product', '')) <> ''
),
ranked AS (
  SELECT
    items.*,
    row_number() OVER (
      PARTITION BY project_id, lower(label), lower(product)
      ORDER BY CASE WHEN primer_override_id IS NOT NULL THEN 0 ELSE 1 END, label
    ) AS n
  FROM items
),
resolved AS (
  SELECT
    r.project_id,
    r.label,
    r.product,
    public.resolve_job_paint_primer(r.product, r.manufacturer, coalesce(r.primer_override_id, '')) AS primer
  FROM ranked r
  WHERE r.n = 1
)
UPDATE public.project_approved_brushouts b
SET
  catalog_item_id = CASE
    WHEN s.primer->>'catalog_item_id' IS NULL OR s.primer->>'catalog_item_id' = '' THEN NULL
    ELSE (s.primer->>'catalog_item_id')::uuid
  END,
  primer_catalog_id = CASE
    WHEN s.primer->>'primer_catalog_id' IS NULL OR s.primer->>'primer_catalog_id' = '' THEN NULL
    ELSE (s.primer->>'primer_catalog_id')::uuid
  END,
  primer_name = nullif(s.primer->>'primer_name', ''),
  self_priming = (s.primer->>'self_priming')::boolean,
  updated_at = now()
FROM resolved s
WHERE b.approved
  AND b.project_id = s.project_id
  AND lower(btrim(b.label)) = lower(btrim(s.label))
  AND lower(btrim(b.product)) = lower(btrim(s.product))
  AND coalesce((s.primer->>'matched')::boolean, false);

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
        'paint_vendor', b.paint_vendor,
        'catalog_item_id', b.catalog_item_id,
        'primer_catalog_id', b.primer_catalog_id,
        'primer_name', b.primer_name,
        'self_priming', b.self_priming
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

GRANT EXECUTE ON FUNCTION public.field_tools_get_approved_brushouts(uuid, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.field_tools_list_paint_product_flags(
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

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'is_primer', c.is_primer,
      'vendors', (
        SELECT coalesce(jsonb_agg(v.name ORDER BY v.sort_order, v.name), '[]'::jsonb)
        FROM public.field_tools_catalog_item_vendors civ
        JOIN public.field_tools_vendors v ON v.id = civ.vendor_id
        WHERE civ.catalog_item_id = c.id
      )
    ) ORDER BY c.name)
    FROM public.field_tools_catalog_items c
    WHERE c.active
      AND c.section = 'paint_product'
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_list_paint_product_flags(uuid, text) TO anon, authenticated;
