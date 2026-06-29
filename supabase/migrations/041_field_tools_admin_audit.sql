-- Field Tools admin: list all orders for a job/project (audit)

CREATE OR REPLACE FUNCTION public.field_tools_admin_list_orders_by_job(
  p_caller_id uuid,
  p_job_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean text;
  v_orders jsonb;
  v_job_name text;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);

  v_clean := split_part(trim(coalesce(p_job_number, '')), ' ', 1);
  IF v_clean = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Job number is required');
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'job_number', o.job_number,
        'job_name', o.job_name,
        'po_number', o.po_number,
        'order_type', o.order_type,
        'status', o.status,
        'email_status', o.email_status,
        'submitted_by_name', o.submitted_by_name,
        'submitted_by_email', o.submitted_by_email,
        'site_contact', o.site_contact,
        'notes', o.notes,
        'delivery_type', o.delivery_type,
        'date_needed', o.date_needed,
        'crew_kit', o.crew_kit,
        'crew_count', o.crew_count,
        'payload', o.payload,
        'created_at', o.created_at
      )
      ORDER BY o.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_orders
  FROM public.field_tools_orders o
  WHERE split_part(trim(o.job_number), ' ', 1) = v_clean
     OR lower(trim(o.job_number)) = lower(trim(p_job_number));

  SELECT coalesce(nullif(trim(o.job_name), ''), '')
  INTO v_job_name
  FROM public.field_tools_orders o
  WHERE split_part(trim(o.job_number), ' ', 1) = v_clean
     OR lower(trim(o.job_number)) = lower(trim(p_job_number))
  ORDER BY o.created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'job_number', v_clean,
    'job_name', coalesce(v_job_name, ''),
    'orders', v_orders
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_admin_list_orders_by_job(uuid, text) TO anon, authenticated;
