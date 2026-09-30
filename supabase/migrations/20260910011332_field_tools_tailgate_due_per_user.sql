-- Safety Tailgate due dates are per employee, not company-wide.
-- Completing a talk no longer marks every other user (including new profiles) as done for the week.

CREATE INDEX IF NOT EXISTS field_tools_tailgate_meetings_submitted_by_idx
  ON public.field_tools_tailgate_meetings (submitted_by_profile_id, completed_at DESC);

CREATE OR REPLACE FUNCTION public.field_tools_tailgate_profile_last_completed_at(p_profile_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT max(x.completed_at)
  FROM (
    SELECT m.completed_at
    FROM public.field_tools_tailgate_meetings m
    WHERE m.submitted_by_profile_id = p_profile_id
    UNION ALL
    SELECT m.completed_at
    FROM public.field_tools_tailgate_meetings m
    JOIN public.field_tools_profiles p ON p.id = p_profile_id
    WHERE EXISTS (
      SELECT 1
      FROM jsonb_array_elements(coalesce(m.attendees, '[]'::jsonb)) a
      WHERE lower(trim(coalesce(a->>'name', ''))) <> ''
        AND lower(trim(a->>'name')) = lower(trim(p.name))
    )
  ) x;
$$;

REVOKE ALL ON FUNCTION public.field_tools_tailgate_profile_last_completed_at(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.field_tools_tailgate_current(
  p_caller_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.field_tools_tailgate_settings%ROWTYPE;
  v_topic public.field_tools_tailgate_topics%ROWTYPE;
  v_topic_id uuid;
  v_last_at timestamptz;
  v_next_due timestamptz;
  v_due boolean;
  v_queue jsonb;
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);

  SELECT * INTO v_settings FROM public.field_tools_tailgate_settings WHERE id = 1;
  IF NOT FOUND THEN
    INSERT INTO public.field_tools_tailgate_settings (id) VALUES (1)
    RETURNING * INTO v_settings;
  END IF;

  v_last_at := public.field_tools_tailgate_profile_last_completed_at(p_caller_id);
  IF v_last_at IS NULL THEN
    v_due := true;
    v_next_due := now();
  ELSE
    v_next_due := v_last_at + public.field_tools_tailgate_cadence_interval(v_settings.cadence);
    v_due := now() >= v_next_due;
  END IF;

  v_topic_id := public.field_tools_tailgate_current_topic_id();
  IF v_topic_id IS NOT NULL THEN
    SELECT * INTO v_topic FROM public.field_tools_tailgate_topics WHERE id = v_topic_id;
  END IF;

  SELECT coalesce(jsonb_agg(row_json ORDER BY sort_order, created_at), '[]'::jsonb)
  INTO v_queue
  FROM (
    SELECT
      t.sort_order,
      t.created_at,
      jsonb_build_object(
        'id', t.id,
        'sort_order', t.sort_order,
        'title', t.title,
        'is_current', t.id = v_topic_id
      ) AS row_json
    FROM public.field_tools_tailgate_topics t
    WHERE t.active = true
  ) q;

  RETURN jsonb_build_object(
    'ok', true,
    'settings', jsonb_build_object(
      'cadence', v_settings.cadence,
      'has_email', trim(v_settings.to_email) <> '',
      'last_completed_at', v_last_at,
      'next_due_at', v_next_due,
      'due', v_due
    ),
    'topic', CASE WHEN v_topic.id IS NULL THEN NULL ELSE public.field_tools_tailgate_topic_public_json(v_topic, true) END,
    'queue', v_queue
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_tailgate_hub_status(
  p_caller_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.field_tools_tailgate_settings%ROWTYPE;
  v_last_at timestamptz;
  v_next_due timestamptz;
  v_due boolean;
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);
  SELECT * INTO v_settings FROM public.field_tools_tailgate_settings WHERE id = 1;
  IF NOT FOUND THEN
    INSERT INTO public.field_tools_tailgate_settings (id) VALUES (1) RETURNING * INTO v_settings;
  END IF;
  v_last_at := public.field_tools_tailgate_profile_last_completed_at(p_caller_id);
  IF v_last_at IS NULL THEN
    v_due := true;
    v_next_due := now();
  ELSE
    v_next_due := v_last_at + public.field_tools_tailgate_cadence_interval(v_settings.cadence);
    v_due := now() >= v_next_due;
  END IF;
  RETURN jsonb_build_object('ok', true, 'due', v_due, 'next_due_at', v_next_due);
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_tailgate_current(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_tailgate_hub_status(uuid, text) TO anon, authenticated;
