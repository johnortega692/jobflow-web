-- To address filled into the crew member's mail app for Field Report and Safety Inspection.

CREATE TABLE IF NOT EXISTS public.field_tools_safety_record_mail (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  field_report_to_email text NOT NULL DEFAULT '',
  inspection_to_email text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.field_tools_safety_record_mail (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.field_tools_safety_record_mail ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS field_tools_safety_record_mail_deny ON public.field_tools_safety_record_mail;
CREATE POLICY field_tools_safety_record_mail_deny
  ON public.field_tools_safety_record_mail
  FOR ALL
  USING (false);

CREATE OR REPLACE FUNCTION public.field_tools_safety_record_mail(
  p_caller_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.field_tools_safety_record_mail%ROWTYPE;
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);
  SELECT * INTO s FROM public.field_tools_safety_record_mail WHERE id = 1;
  RETURN jsonb_build_object(
    'ok', true,
    'field_report_to_email', coalesce(s.field_report_to_email, ''),
    'inspection_to_email', coalesce(s.inspection_to_email, '')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_safety_record_mail(
  p_caller_id uuid,
  p_session_token text,
  p_kind text,
  p_to_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text := lower(trim(coalesce(p_kind, '')));
  v_to text;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);

  IF v_kind NOT IN ('field_report', 'inspection') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Choose Field Report or Safety Inspection.');
  END IF;

  BEGIN
    v_to := public.field_tools_tailgate_normalize_emails(p_to_email);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
  END;

  INSERT INTO public.field_tools_safety_record_mail (id)
  VALUES (1)
  ON CONFLICT (id) DO NOTHING;

  IF v_kind = 'field_report' THEN
    UPDATE public.field_tools_safety_record_mail
    SET field_report_to_email = v_to, updated_at = now()
    WHERE id = 1;
  ELSE
    UPDATE public.field_tools_safety_record_mail
    SET inspection_to_email = v_to, updated_at = now()
    WHERE id = 1;
  END IF;

  RETURN jsonb_build_object('ok', true, 'to_email', v_to);
END;
$$;

REVOKE ALL ON FUNCTION public.field_tools_safety_record_mail(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.field_tools_admin_upsert_safety_record_mail(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.field_tools_safety_record_mail(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_safety_record_mail(uuid, text, text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
