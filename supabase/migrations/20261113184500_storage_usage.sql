-- Totals for uploaded files, so every approved user can see storage use in Settings.

CREATE OR REPLACE FUNCTION public.storage_usage()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Approved account required';
  END IF;

  SELECT jsonb_build_object(
    'buckets',
    coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'bucket', bucket,
          'files', files,
          'bytes', bytes
        )
        ORDER BY bytes DESC, bucket
      )
      FROM (
        SELECT
          bk.id AS bucket,
          count(o.id)::int AS files,
          coalesce(sum((o.metadata->>'size')::bigint), 0) AS bytes
        FROM storage.buckets bk
        LEFT JOIN storage.objects o ON o.bucket_id = bk.id
        GROUP BY bk.id
      ) usage
    ), '[]'::jsonb),
    'largest',
    coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'bucket', bucket,
          'path', path,
          'bytes', bytes,
          'created_at', created_at
        )
        ORDER BY bytes DESC
      )
      FROM (
        SELECT
          o.bucket_id AS bucket,
          o.name AS path,
          coalesce((o.metadata->>'size')::bigint, 0) AS bytes,
          o.created_at
        FROM storage.objects o
        ORDER BY coalesce((o.metadata->>'size')::bigint, 0) DESC, o.created_at DESC
        LIMIT 8
      ) files
    ), '[]'::jsonb)
  )
  INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.storage_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_usage() TO authenticated;

COMMENT ON FUNCTION public.storage_usage() IS
  'File counts and sizes by storage bucket, plus the largest uploads. Approved users only.';
