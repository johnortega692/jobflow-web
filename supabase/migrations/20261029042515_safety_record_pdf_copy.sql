-- Keep the PDF that was emailed with a field report or safety inspection.
-- Office users can open it from JobFlow. Field Tools opens it through the email function.

ALTER TABLE public.field_tools_field_reports
  ADD COLUMN IF NOT EXISTS pdf_storage_path text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS pdf_filename text NOT NULL DEFAULT '';

ALTER TABLE public.field_tools_safety_inspections
  ADD COLUMN IF NOT EXISTS pdf_storage_path text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS pdf_filename text NOT NULL DEFAULT '';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'safety-record-pdfs',
  'safety-record-pdfs',
  false,
  26214400,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS safety_record_pdfs_authenticated_read ON storage.objects;
CREATE POLICY safety_record_pdfs_authenticated_read
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'safety-record-pdfs'
    AND public.is_approved_user(auth.uid())
    AND (
      EXISTS (
        SELECT 1 FROM public.field_tools_field_reports r
        WHERE r.pdf_storage_path = name
          AND r.pdf_storage_path <> ''
      )
      OR EXISTS (
        SELECT 1 FROM public.field_tools_safety_inspections i
        WHERE i.pdf_storage_path = name
          AND i.pdf_storage_path <> ''
      )
    )
  );

DROP FUNCTION IF EXISTS public.list_field_reports_for_jobflow(uuid);
CREATE FUNCTION public.list_field_reports_for_jobflow(p_project_id uuid)
RETURNS TABLE (
  id uuid,
  report_date date,
  job_name text,
  superintendent text,
  contractor text,
  location text,
  weather jsonb,
  manpower jsonb,
  materials text,
  work_performed text,
  delays text[],
  delay_notes text,
  toolbox_talk text,
  incidents text,
  ppe_housekeeping text,
  safety_notes text,
  reported_by text,
  reporter_title text,
  sign_date date,
  photos jsonb,
  submitted_by_name text,
  completed_at timestamptz,
  status text,
  updated_at timestamptz,
  pdf_storage_path text,
  pdf_filename text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id,
    r.report_date,
    r.job_name,
    r.superintendent,
    r.contractor,
    r.location,
    r.weather,
    r.manpower,
    r.materials,
    r.work_performed,
    r.delays,
    r.delay_notes,
    r.toolbox_talk,
    r.incidents,
    r.ppe_housekeeping,
    r.safety_notes,
    r.reported_by,
    r.reporter_title,
    r.sign_date,
    '[]'::jsonb,
    coalesce(nullif(trim(r.submitted_by_name), ''), 'Field user'),
    r.completed_at,
    r.status,
    r.updated_at,
    r.pdf_storage_path,
    r.pdf_filename
  FROM public.field_tools_field_reports r
  JOIN public.projects p ON p.id = p_project_id
  WHERE public.is_approved_user(auth.uid())
    AND (
      r.project_id = p.id
      OR (
        r.project_id IS NULL
        AND trim(r.job_number) <> ''
        AND trim(r.job_number) = trim(p.job_number)
      )
    )
  ORDER BY r.updated_at DESC;
$$;

DROP FUNCTION IF EXISTS public.list_safety_inspections_for_jobflow(uuid);
CREATE FUNCTION public.list_safety_inspections_for_jobflow(p_project_id uuid)
RETURNS TABLE (
  id uuid,
  week_ending date,
  inspector_name text,
  inspection_date date,
  submitted_by_name text,
  completed_at timestamptz,
  other_concerns text,
  accident_attached boolean,
  ok_count integer,
  attention_count integer,
  na_count integer,
  items jsonb,
  status text,
  updated_at timestamptz,
  pdf_storage_path text,
  pdf_filename text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    i.id,
    i.week_ending,
    i.inspector_name,
    i.inspection_date,
    coalesce(nullif(trim(i.submitted_by_name), ''), 'Field user'),
    i.completed_at,
    i.other_concerns,
    i.accident_attached,
    (SELECT count(*)::integer FROM jsonb_array_elements(i.items) e WHERE e->>'status' = 'ok'),
    (SELECT count(*)::integer FROM jsonb_array_elements(i.items) e WHERE e->>'status' = 'attention'),
    (SELECT count(*)::integer FROM jsonb_array_elements(i.items) e WHERE e->>'status' = 'na'),
    i.items,
    i.status,
    i.updated_at,
    i.pdf_storage_path,
    i.pdf_filename
  FROM public.field_tools_safety_inspections i
  JOIN public.projects p ON p.id = p_project_id
  WHERE public.is_approved_user(auth.uid())
    AND (
      i.project_id = p.id
      OR (
        i.project_id IS NULL
        AND trim(i.job_number) <> ''
        AND trim(i.job_number) = trim(p.job_number)
      )
    )
  ORDER BY i.updated_at DESC;
$$;

REVOKE ALL ON FUNCTION public.list_field_reports_for_jobflow(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_safety_inspections_for_jobflow(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_field_reports_for_jobflow(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.list_safety_inspections_for_jobflow(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_field_reports_for_jobflow(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_safety_inspections_for_jobflow(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
