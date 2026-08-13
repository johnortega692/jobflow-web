-- Safety Tailgate: sequential topics, crew sign-in, cadence, email settings.

CREATE TABLE IF NOT EXISTS public.field_tools_tailgate_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cadence text NOT NULL DEFAULT 'weekly'
    CHECK (cadence IN ('weekly', 'twice_weekly', 'monthly')),
  to_email text NOT NULL DEFAULT '',
  cc_emails text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.field_tools_tailgate_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.field_tools_tailgate_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sort_order integer NOT NULL DEFAULT 1,
  title text NOT NULL,
  body_text text NOT NULL DEFAULT '',
  image_mime text,
  image_bytes bytea,
  pdf_name text,
  pdf_bytes bytea,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS field_tools_tailgate_topics_order_idx
  ON public.field_tools_tailgate_topics (active, sort_order, created_at);

CREATE TABLE IF NOT EXISTS public.field_tools_tailgate_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES public.field_tools_tailgate_topics(id),
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  job_number text NOT NULL DEFAULT '',
  job_name text NOT NULL DEFAULT '',
  submitted_by_profile_id uuid NOT NULL REFERENCES public.field_tools_profiles(id),
  submitted_by_name text NOT NULL DEFAULT '',
  attendees jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text NOT NULL DEFAULT '',
  email_status text NOT NULL DEFAULT 'pending'
    CHECK (email_status IN ('pending', 'sent', 'skipped', 'failed')),
  email_error text,
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS field_tools_tailgate_meetings_completed_idx
  ON public.field_tools_tailgate_meetings (completed_at DESC);

ALTER TABLE public.field_tools_tailgate_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_tools_tailgate_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_tools_tailgate_meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS field_tools_tailgate_settings_deny ON public.field_tools_tailgate_settings;
CREATE POLICY field_tools_tailgate_settings_deny ON public.field_tools_tailgate_settings
  FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS field_tools_tailgate_topics_deny ON public.field_tools_tailgate_topics;
CREATE POLICY field_tools_tailgate_topics_deny ON public.field_tools_tailgate_topics
  FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS field_tools_tailgate_meetings_deny ON public.field_tools_tailgate_meetings;
CREATE POLICY field_tools_tailgate_meetings_deny ON public.field_tools_tailgate_meetings
  FOR ALL USING (false) WITH CHECK (false);

UPDATE public.field_tools_profiles
SET modules = array_append(modules, 'safety_tailgate')
WHERE NOT ('safety_tailgate' = ANY (modules));

-- ── Helpers ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.field_tools_tailgate_cadence_interval(p_cadence text)
RETURNS interval
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(trim(coalesce(p_cadence, 'weekly')))
    WHEN 'twice_weekly' THEN interval '3 days'
    WHEN 'monthly' THEN interval '30 days'
    ELSE interval '7 days'
  END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_tailgate_normalize_emails(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  parts text[];
  part text;
  out_text text := '';
  i int;
BEGIN
  IF trim(coalesce(p_raw, '')) = '' THEN
    RETURN '';
  END IF;
  parts := regexp_split_to_array(p_raw, '[,;]');
  FOR i IN 1..coalesce(array_length(parts, 1), 0) LOOP
    part := lower(trim(parts[i]));
    IF part = '' THEN
      CONTINUE;
    END IF;
    IF part !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      RAISE EXCEPTION 'Enter valid email addresses (comma-separated).' USING ERRCODE = 'P0001';
    END IF;
    IF out_text <> '' THEN
      out_text := out_text || ',';
    END IF;
    out_text := out_text || part;
  END LOOP;
  RETURN out_text;
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_decode_data_url(p_raw text)
RETURNS bytea
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v text := trim(coalesce(p_raw, ''));
BEGIN
  IF v = '' THEN
    RETURN NULL;
  END IF;
  IF v ~ '^data:' THEN
    v := substring(v FROM position(',' IN v) + 1);
  END IF;
  RETURN decode(v, 'base64');
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_tailgate_current_topic_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_topic uuid;
  v_last_order integer;
  v_last_created timestamptz;
  v_next uuid;
  v_first uuid;
BEGIN
  SELECT t.id INTO v_first
  FROM public.field_tools_tailgate_topics t
  WHERE t.active = true
  ORDER BY t.sort_order ASC, t.created_at ASC
  LIMIT 1;

  SELECT m.topic_id INTO v_last_topic
  FROM public.field_tools_tailgate_meetings m
  ORDER BY m.completed_at DESC, m.created_at DESC
  LIMIT 1;

  IF v_last_topic IS NULL THEN
    RETURN v_first;
  END IF;

  SELECT t.sort_order, t.created_at INTO v_last_order, v_last_created
  FROM public.field_tools_tailgate_topics t
  WHERE t.id = v_last_topic;

  SELECT t.id INTO v_next
  FROM public.field_tools_tailgate_topics t
  WHERE t.active = true
    AND (
      t.sort_order > coalesce(v_last_order, 0)
      OR (
        t.sort_order = coalesce(v_last_order, 0)
        AND t.created_at > coalesce(v_last_created, '-infinity'::timestamptz)
      )
    )
  ORDER BY t.sort_order ASC, t.created_at ASC
  LIMIT 1;

  RETURN coalesce(v_next, v_first);
END;
$$;

REVOKE ALL ON FUNCTION public.field_tools_tailgate_current_topic_id() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.field_tools_tailgate_topic_public_json(
  p_topic public.field_tools_tailgate_topics,
  p_include_media boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN jsonb_build_object(
    'id', p_topic.id,
    'sort_order', p_topic.sort_order,
    'title', p_topic.title,
    'body_text', p_topic.body_text,
    'active', p_topic.active,
    'has_image', p_topic.image_bytes IS NOT NULL,
    'has_pdf', p_topic.pdf_bytes IS NOT NULL,
    'pdf_name', coalesce(p_topic.pdf_name, ''),
    'image_mime', CASE WHEN p_include_media THEN coalesce(p_topic.image_mime, '') ELSE '' END,
    'image_base64', CASE
      WHEN p_include_media AND p_topic.image_bytes IS NOT NULL THEN encode(p_topic.image_bytes, 'base64')
      ELSE NULL
    END,
    'pdf_base64', CASE
      WHEN p_include_media AND p_topic.pdf_bytes IS NOT NULL THEN encode(p_topic.pdf_bytes, 'base64')
      ELSE NULL
    END,
    'updated_at', p_topic.updated_at
  );
END;
$$;

-- ── Field RPCs ──────────────────────────────────────────────────────────

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

  SELECT max(m.completed_at) INTO v_last_at FROM public.field_tools_tailgate_meetings m;
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

CREATE OR REPLACE FUNCTION public.field_tools_submit_tailgate_meeting(
  p_caller_id uuid,
  p_session_token text,
  p_topic_id uuid,
  p_project_id uuid,
  p_job_number text,
  p_job_name text,
  p_attendees jsonb,
  p_notes text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current uuid;
  v_profile public.field_tools_profiles%ROWTYPE;
  v_to text;
  v_status text;
  v_id uuid;
  v_att jsonb;
  v_name text;
  v_sig text;
  v_count int := 0;
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);

  SELECT * INTO v_profile
  FROM public.field_tools_profiles
  WHERE id = p_caller_id AND active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Profile not found');
  END IF;

  v_current := public.field_tools_tailgate_current_topic_id();
  IF v_current IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No active tailgate topics. Ask the office to add one.');
  END IF;
  IF p_topic_id IS DISTINCT FROM v_current THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Finish the current tailgate topic before moving to the next one.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.field_tools_tailgate_topics WHERE id = p_topic_id AND active = true) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'That topic is no longer active.');
  END IF;

  IF trim(coalesce(p_job_number, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pick a job for this tailgate.');
  END IF;

  IF p_project_id IS NOT NULL
     AND NOT public.field_tools_profile_can_access_project(p_caller_id, p_project_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'You don''t have access to this job.');
  END IF;

  IF jsonb_typeof(coalesce(p_attendees, 'null'::jsonb)) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'At least one printed name and signature is required.');
  END IF;

  FOR v_att IN SELECT value FROM jsonb_array_elements(p_attendees)
  LOOP
    v_name := trim(coalesce(v_att->>'name', ''));
    v_sig := trim(coalesce(v_att->>'signature_png', v_att->>'signature', ''));
    IF v_name = '' OR v_sig = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Each person needs a printed name and a signature.');
    END IF;
    v_count := v_count + 1;
  END LOOP;

  IF v_count < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'At least one printed name and signature is required.');
  END IF;

  SELECT trim(to_email) INTO v_to FROM public.field_tools_tailgate_settings WHERE id = 1;
  v_status := CASE WHEN coalesce(v_to, '') = '' THEN 'skipped' ELSE 'pending' END;

  INSERT INTO public.field_tools_tailgate_meetings (
    topic_id, project_id, job_number, job_name,
    submitted_by_profile_id, submitted_by_name,
    attendees, notes, email_status
  ) VALUES (
    p_topic_id,
    p_project_id,
    trim(p_job_number),
    trim(coalesce(p_job_name, '')),
    p_caller_id,
    coalesce(nullif(trim(v_profile.name), ''), 'Field user'),
    p_attendees,
    trim(coalesce(p_notes, '')),
    v_status
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true,
    'meeting_id', v_id,
    'will_email', v_status = 'pending'
  );
END;
$$;

-- ── Admin RPCs ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.field_tools_admin_get_tailgate_settings(
  p_caller_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.field_tools_tailgate_settings%ROWTYPE;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);
  SELECT * INTO s FROM public.field_tools_tailgate_settings WHERE id = 1;
  RETURN jsonb_build_object(
    'ok', true,
    'settings', jsonb_build_object(
      'cadence', coalesce(s.cadence, 'weekly'),
      'to_email', coalesce(s.to_email, ''),
      'cc_emails', coalesce(s.cc_emails, ''),
      'updated_at', s.updated_at
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_tailgate_settings(
  p_caller_id uuid,
  p_session_token text,
  p_cadence text,
  p_to_email text,
  p_cc_emails text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cadence text := lower(trim(coalesce(p_cadence, 'weekly')));
  v_to text;
  v_cc text;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);

  IF v_cadence NOT IN ('weekly', 'twice_weekly', 'monthly') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cadence must be weekly, twice a week, or monthly.');
  END IF;

  BEGIN
    v_to := public.field_tools_tailgate_normalize_emails(p_to_email);
    v_cc := public.field_tools_tailgate_normalize_emails(p_cc_emails);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
  END;

  IF position(',' IN v_to) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Use one To address. Put extras in CC.');
  END IF;

  INSERT INTO public.field_tools_tailgate_settings (id, cadence, to_email, cc_emails, updated_at)
  VALUES (1, v_cadence, v_to, v_cc, now())
  ON CONFLICT (id) DO UPDATE SET
    cadence = EXCLUDED.cadence,
    to_email = EXCLUDED.to_email,
    cc_emails = EXCLUDED.cc_emails,
    updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_list_tailgate_topics(
  p_caller_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);
  RETURN jsonb_build_object(
    'ok', true,
    'topics', coalesce((
      SELECT jsonb_agg(public.field_tools_tailgate_topic_public_json(t, false) ORDER BY t.sort_order, t.created_at)
      FROM public.field_tools_tailgate_topics t
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_get_tailgate_topic(
  p_caller_id uuid,
  p_session_token text,
  p_topic_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.field_tools_tailgate_topics%ROWTYPE;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);
  SELECT * INTO t FROM public.field_tools_tailgate_topics WHERE id = p_topic_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Topic not found');
  END IF;
  RETURN jsonb_build_object('ok', true, 'topic', public.field_tools_tailgate_topic_public_json(t, true));
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_tailgate_topic(
  p_caller_id uuid,
  p_session_token text,
  p_id uuid DEFAULT NULL,
  p_title text DEFAULT '',
  p_body_text text DEFAULT '',
  p_active boolean DEFAULT true,
  p_image_base64 text DEFAULT NULL,
  p_image_mime text DEFAULT NULL,
  p_pdf_base64 text DEFAULT NULL,
  p_pdf_name text DEFAULT NULL,
  p_clear_image boolean DEFAULT false,
  p_clear_pdf boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_title text := trim(coalesce(p_title, ''));
  v_order integer;
  v_image bytea;
  v_pdf bytea;
  v_image_mime text := nullif(lower(trim(coalesce(p_image_mime, ''))), '');
  v_pdf_name text := nullif(trim(coalesce(p_pdf_name, '')), '');
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);

  IF v_title = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Title is required.');
  END IF;

  IF p_image_base64 IS NOT NULL AND trim(p_image_base64) <> '' THEN
    IF length(p_image_base64) > 2800000 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Image is too large. Use a photo under about 1.5 MB.');
    END IF;
    BEGIN
      v_image := public.field_tools_decode_data_url(p_image_base64);
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Could not read the image.');
    END;
    IF v_image_mime IS NULL OR v_image_mime NOT IN ('image/jpeg', 'image/jpg', 'image/png', 'image/webp') THEN
      v_image_mime := 'image/jpeg';
    END IF;
  END IF;

  IF p_pdf_base64 IS NOT NULL AND trim(p_pdf_base64) <> '' THEN
    IF length(p_pdf_base64) > 7500000 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'PDF is too large. Keep it under 5 MB.');
    END IF;
    BEGIN
      v_pdf := public.field_tools_decode_data_url(p_pdf_base64);
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Could not read the PDF.');
    END;
    IF v_pdf_name IS NULL THEN
      v_pdf_name := 'tailgate.pdf';
    END IF;
  END IF;

  IF p_id IS NULL THEN
    SELECT coalesce(max(sort_order), 0) + 1 INTO v_order FROM public.field_tools_tailgate_topics;
    INSERT INTO public.field_tools_tailgate_topics (
      sort_order, title, body_text, active, image_mime, image_bytes, pdf_name, pdf_bytes
    ) VALUES (
      v_order, v_title, trim(coalesce(p_body_text, '')), coalesce(p_active, true),
      CASE WHEN v_image IS NULL THEN NULL ELSE v_image_mime END,
      v_image,
      CASE WHEN v_pdf IS NULL THEN NULL ELSE v_pdf_name END,
      v_pdf
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.field_tools_tailgate_topics SET
      title = v_title,
      body_text = trim(coalesce(p_body_text, '')),
      active = coalesce(p_active, true),
      image_mime = CASE
        WHEN p_clear_image THEN NULL
        WHEN v_image IS NOT NULL THEN v_image_mime
        ELSE image_mime
      END,
      image_bytes = CASE
        WHEN p_clear_image THEN NULL
        WHEN v_image IS NOT NULL THEN v_image
        ELSE image_bytes
      END,
      pdf_name = CASE
        WHEN p_clear_pdf THEN NULL
        WHEN v_pdf IS NOT NULL THEN v_pdf_name
        ELSE pdf_name
      END,
      pdf_bytes = CASE
        WHEN p_clear_pdf THEN NULL
        WHEN v_pdf IS NOT NULL THEN v_pdf
        ELSE pdf_bytes
      END,
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Topic not found');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_move_tailgate_topic(
  p_caller_id uuid,
  p_session_token text,
  p_topic_id uuid,
  p_direction text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dir text := lower(trim(coalesce(p_direction, '')));
  a public.field_tools_tailgate_topics%ROWTYPE;
  b public.field_tools_tailgate_topics%ROWTYPE;
  tmp integer;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);
  SELECT * INTO a FROM public.field_tools_tailgate_topics WHERE id = p_topic_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Topic not found');
  END IF;

  IF v_dir = 'up' THEN
    SELECT * INTO b
    FROM public.field_tools_tailgate_topics
    WHERE sort_order < a.sort_order OR (sort_order = a.sort_order AND created_at < a.created_at)
    ORDER BY sort_order DESC, created_at DESC
    LIMIT 1;
  ELSIF v_dir = 'down' THEN
    SELECT * INTO b
    FROM public.field_tools_tailgate_topics
    WHERE sort_order > a.sort_order OR (sort_order = a.sort_order AND created_at > a.created_at)
    ORDER BY sort_order ASC, created_at ASC
    LIMIT 1;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'Direction must be up or down.');
  END IF;

  IF b.id IS NULL THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  tmp := a.sort_order;
  UPDATE public.field_tools_tailgate_topics SET sort_order = b.sort_order, updated_at = now() WHERE id = a.id;
  UPDATE public.field_tools_tailgate_topics SET sort_order = tmp, updated_at = now() WHERE id = b.id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_delete_tailgate_topic(
  p_caller_id uuid,
  p_session_token text,
  p_topic_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);
  IF EXISTS (SELECT 1 FROM public.field_tools_tailgate_meetings WHERE topic_id = p_topic_id) THEN
    UPDATE public.field_tools_tailgate_topics SET active = false, updated_at = now() WHERE id = p_topic_id;
    RETURN jsonb_build_object('ok', true, 'deactivated', true);
  END IF;
  DELETE FROM public.field_tools_tailgate_topics WHERE id = p_topic_id;
  RETURN jsonb_build_object('ok', true, 'deactivated', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_list_tailgate_meetings(
  p_caller_id uuid,
  p_session_token text,
  p_limit integer DEFAULT 40
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 40), 100));
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);
  RETURN jsonb_build_object(
    'ok', true,
    'meetings', coalesce((
      SELECT jsonb_agg(row_json ORDER BY completed_at DESC)
      FROM (
        SELECT
          m.completed_at,
          jsonb_build_object(
            'id', m.id,
            'topic_id', m.topic_id,
            'topic_title', t.title,
            'job_number', m.job_number,
            'job_name', m.job_name,
            'submitted_by_name', m.submitted_by_name,
            'attendee_names', coalesce((
              SELECT jsonb_agg(trim(a->>'name'))
              FROM jsonb_array_elements(m.attendees) a
              WHERE trim(coalesce(a->>'name', '')) <> ''
            ), '[]'::jsonb),
            'email_status', m.email_status,
            'email_error', m.email_error,
            'completed_at', m.completed_at
          ) AS row_json
        FROM public.field_tools_tailgate_meetings m
        JOIN public.field_tools_tailgate_topics t ON t.id = m.topic_id
        ORDER BY m.completed_at DESC
        LIMIT v_limit
      ) q
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.field_tools_tailgate_cadence_interval(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.field_tools_tailgate_normalize_emails(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.field_tools_decode_data_url(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.field_tools_tailgate_topic_public_json(public.field_tools_tailgate_topics, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.field_tools_tailgate_current(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_submit_tailgate_meeting(uuid, text, uuid, uuid, text, text, jsonb, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_get_tailgate_settings(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_tailgate_settings(uuid, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_list_tailgate_topics(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_get_tailgate_topic(uuid, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_tailgate_topic(uuid, text, uuid, text, text, boolean, text, text, text, text, boolean, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_move_tailgate_topic(uuid, text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_delete_tailgate_topic(uuid, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_list_tailgate_meetings(uuid, text, integer) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.field_tools_tailgate_meeting_packet(p_meeting_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m public.field_tools_tailgate_meetings%ROWTYPE;
  t public.field_tools_tailgate_topics%ROWTYPE;
  s public.field_tools_tailgate_settings%ROWTYPE;
  v_email text := '';
BEGIN
  SELECT * INTO m FROM public.field_tools_tailgate_meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Meeting not found');
  END IF;
  SELECT * INTO t FROM public.field_tools_tailgate_topics WHERE id = m.topic_id;
  SELECT * INTO s FROM public.field_tools_tailgate_settings WHERE id = 1;
  SELECT coalesce(nullif(trim(p.email), ''), '') INTO v_email
  FROM public.field_tools_profiles p WHERE p.id = m.submitted_by_profile_id;

  RETURN jsonb_build_object(
    'ok', true,
    'meeting', jsonb_build_object(
      'id', m.id,
      'job_number', m.job_number,
      'job_name', m.job_name,
      'submitted_by_name', m.submitted_by_name,
      'submitted_by_email', v_email,
      'attendees', m.attendees,
      'notes', m.notes,
      'completed_at', m.completed_at,
      'email_status', m.email_status
    ),
    'topic', jsonb_build_object(
      'id', t.id,
      'title', t.title,
      'body_text', t.body_text,
      'image_mime', coalesce(t.image_mime, ''),
      'image_base64', CASE WHEN t.image_bytes IS NOT NULL THEN encode(t.image_bytes, 'base64') ELSE NULL END,
      'pdf_name', coalesce(t.pdf_name, ''),
      'pdf_base64', CASE WHEN t.pdf_bytes IS NOT NULL THEN encode(t.pdf_bytes, 'base64') ELSE NULL END
    ),
    'settings', jsonb_build_object(
      'to_email', coalesce(s.to_email, ''),
      'cc_emails', coalesce(s.cc_emails, '')
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.field_tools_tailgate_meeting_packet(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.field_tools_tailgate_meeting_packet(uuid) TO service_role;

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
  SELECT max(m.completed_at) INTO v_last_at FROM public.field_tools_tailgate_meetings m;
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

GRANT EXECUTE ON FUNCTION public.field_tools_tailgate_hub_status(uuid, text) TO anon, authenticated;


