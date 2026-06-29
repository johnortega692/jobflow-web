-- Approved brush-outs: JobFlow PM verifies; Field Tools loads on job select (no GAS sheet).

CREATE TABLE IF NOT EXISTS public.project_approved_brushouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  job_number text NOT NULL DEFAULT '',
  paint_vendor text NOT NULL DEFAULT '',
  label text NOT NULL DEFAULT '',
  floor text NOT NULL DEFAULT '',
  manufacturer text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '',
  product text NOT NULL DEFAULT '',
  sheen text NOT NULL DEFAULT '',
  display_line text NOT NULL DEFAULT '',
  approved boolean NOT NULL DEFAULT false,
  approved_by_name text NOT NULL DEFAULT '',
  approved_at timestamptz,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_approved_brushouts_project_idx
  ON public.project_approved_brushouts (project_id, sort_order);

CREATE INDEX IF NOT EXISTS project_approved_brushouts_job_idx
  ON public.project_approved_brushouts (job_number);

ALTER TABLE public.project_approved_brushouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_approved_brushouts_auth_all ON public.project_approved_brushouts;
CREATE POLICY project_approved_brushouts_auth_all ON public.project_approved_brushouts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS project_approved_brushouts_deny_anon ON public.project_approved_brushouts;
CREATE POLICY project_approved_brushouts_deny_anon ON public.project_approved_brushouts
  FOR ALL TO anon USING (false);

-- Field Tools: read approved lines by job number (PIN app uses anon + RPC).
CREATE OR REPLACE FUNCTION public.field_tools_get_approved_brushouts(p_job_number text)
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

GRANT EXECUTE ON FUNCTION public.field_tools_get_approved_brushouts(text) TO anon, authenticated;
