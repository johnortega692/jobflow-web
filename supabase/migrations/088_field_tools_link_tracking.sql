-- Hub link click tracking (daily field reports / weekly safety inspection).

ALTER TABLE public.field_tools_custom_modules
  ADD COLUMN IF NOT EXISTS track_cadence text NOT NULL DEFAULT ''
    CHECK (track_cadence IN ('', 'daily', 'weekly'));

UPDATE public.field_tools_custom_modules
SET track_cadence = 'daily'
WHERE track_cadence = '' AND title ~* 'field report';

UPDATE public.field_tools_custom_modules
SET track_cadence = 'weekly'
WHERE track_cadence = '' AND title ~* 'safety inspection';

CREATE TABLE IF NOT EXISTS public.field_tools_link_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.field_tools_profiles(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES public.field_tools_custom_modules(id) ON DELETE CASCADE,
  period_key text NOT NULL,
  clicked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, module_id, period_key)
);

CREATE INDEX IF NOT EXISTS field_tools_link_clicks_profile_idx
  ON public.field_tools_link_clicks (profile_id, clicked_at DESC);

ALTER TABLE public.field_tools_link_clicks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS field_tools_link_clicks_deny ON public.field_tools_link_clicks;
CREATE POLICY field_tools_link_clicks_deny ON public.field_tools_link_clicks
  FOR ALL USING (false) WITH CHECK (false);

CREATE TABLE IF NOT EXISTS public.field_tools_link_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cron_secret text NOT NULL DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.field_tools_link_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.field_tools_link_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS field_tools_link_settings_deny ON public.field_tools_link_settings;
CREATE POLICY field_tools_link_settings_deny ON public.field_tools_link_settings
  FOR ALL USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.field_tools_link_period_key(p_cadence text, p_at timestamptz DEFAULT now())
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_local date := (p_at AT TIME ZONE 'America/Los_Angeles')::date;
  v_monday date;
BEGIN
  IF p_cadence = 'weekly' THEN
    v_monday := v_local - ((extract(isodow FROM v_local)::integer) - 1);
    RETURN to_char(v_monday, 'YYYY-MM-DD');
  END IF;
  RETURN to_char(v_local, 'YYYY-MM-DD');
END;
$$;

REVOKE ALL ON FUNCTION public.field_tools_link_period_key(text, timestamptz) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.field_tools_link_due_status(
  p_caller_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);
  RETURN jsonb_build_object(
    'ok', true,
    'links', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', cm.id,
        'title', cm.title,
        'cadence', cm.track_cadence,
        'due', NOT EXISTS (
          SELECT 1
          FROM public.field_tools_link_clicks c
          WHERE c.profile_id = p_caller_id
            AND c.module_id = cm.id
            AND c.period_key = public.field_tools_link_period_key(cm.track_cadence, v_now)
        ),
        'due_label', CASE cm.track_cadence
          WHEN 'daily' THEN 'Due today'
          WHEN 'weekly' THEN 'Due this week'
          ELSE ''
        END
      ) ORDER BY cm.sort_order, cm.title)
      FROM public.field_tools_profile_custom_modules pcm
      JOIN public.field_tools_custom_modules cm ON cm.id = pcm.module_id
      WHERE pcm.profile_id = p_caller_id
        AND cm.active = true
        AND cm.track_cadence IN ('daily', 'weekly')
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_record_link_click(
  p_caller_id uuid,
  p_session_token text,
  p_module_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cadence text;
  v_key text;
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);

  SELECT cm.track_cadence INTO v_cadence
  FROM public.field_tools_custom_modules cm
  JOIN public.field_tools_profile_custom_modules pcm
    ON pcm.module_id = cm.id AND pcm.profile_id = p_caller_id
  WHERE cm.id = p_module_id AND cm.active = true;

  IF v_cadence IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'tracked', false);
  END IF;
  IF v_cadence NOT IN ('daily', 'weekly') THEN
    RETURN jsonb_build_object('ok', true, 'tracked', false);
  END IF;

  v_key := public.field_tools_link_period_key(v_cadence, now());
  INSERT INTO public.field_tools_link_clicks (profile_id, module_id, period_key)
  VALUES (p_caller_id, p_module_id, v_key)
  ON CONFLICT (profile_id, module_id, period_key) DO UPDATE SET clicked_at = now();

  RETURN jsonb_build_object('ok', true, 'tracked', true, 'period_key', v_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_link_incomplete_digest()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(person ORDER BY person->>'name')
    FROM (
      SELECT jsonb_build_object(
        'profile_id', p.id,
        'name', coalesce(nullif(trim(op.name), ''), nullif(trim(p.name), ''), 'Field user'),
        'email', coalesce(nullif(trim(op.email), ''), nullif(trim(p.email), ''), ''),
        'missing', (
          SELECT coalesce(jsonb_agg(cm.title ORDER BY cm.sort_order, cm.title), '[]'::jsonb)
          FROM public.field_tools_profile_custom_modules pcm
          JOIN public.field_tools_custom_modules cm ON cm.id = pcm.module_id
          WHERE pcm.profile_id = p.id
            AND cm.active = true
            AND cm.track_cadence IN ('daily', 'weekly')
            AND NOT EXISTS (
              SELECT 1
              FROM public.field_tools_link_clicks c
              WHERE c.profile_id = p.id
                AND c.module_id = cm.id
                AND c.period_key = public.field_tools_link_period_key(cm.track_cadence, v_now)
            )
        )
      ) AS person
      FROM public.field_tools_profiles p
      LEFT JOIN public.org_people op ON op.id = p.person_id AND op.active = true
      WHERE p.active = true
    ) q
    WHERE jsonb_array_length(person->'missing') > 0
      AND coalesce(person->>'email', '') <> ''
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.field_tools_link_incomplete_digest() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.field_tools_link_incomplete_digest() TO service_role;

GRANT EXECUTE ON FUNCTION public.field_tools_link_due_status(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_record_link_click(uuid, text, uuid) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.field_tools_admin_upsert_custom_module(uuid, text, uuid, text, text, text, integer, boolean);

CREATE OR REPLACE FUNCTION public.field_tools_admin_list_custom_modules(
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
    'modules', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'title', m.title, 'description', m.description, 'url', m.url,
        'sort_order', m.sort_order, 'active', m.active,
        'track_cadence', coalesce(m.track_cadence, '')
      ) ORDER BY m.sort_order, m.title), '[]'::jsonb)
      FROM public.field_tools_custom_modules m
    )
  );
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_custom_module(
  p_caller_id uuid,
  p_session_token text,
  p_module_id uuid,
  p_title text,
  p_description text,
  p_url text,
  p_sort_order integer DEFAULT 0,
  p_active boolean DEFAULT true,
  p_track_cadence text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mid uuid;
  v_cadence text := lower(trim(coalesce(p_track_cadence, '')));
BEGIN
  PERFORM public.field_tools_require_strict_admin(p_caller_id, p_session_token);
  IF p_title IS NULL OR length(trim(p_title)) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Title is required');
  END IF;
  IF p_url IS NULL OR length(trim(p_url)) < 4 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'URL is required');
  END IF;
  IF v_cadence NOT IN ('', 'daily', 'weekly') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Track must be off, daily, or weekly.');
  END IF;

  IF p_module_id IS NULL THEN
    INSERT INTO public.field_tools_custom_modules (title, description, url, sort_order, active, track_cadence)
    VALUES (trim(p_title), coalesce(p_description, ''), trim(p_url), coalesce(p_sort_order, 0), coalesce(p_active, true), v_cadence)
    RETURNING id INTO mid;
  ELSE
    UPDATE public.field_tools_custom_modules SET
      title = trim(p_title),
      description = coalesce(p_description, ''),
      url = trim(p_url),
      sort_order = coalesce(p_sort_order, sort_order),
      active = coalesce(p_active, active),
      track_cadence = v_cadence,
      updated_at = now()
    WHERE id = p_module_id
    RETURNING id INTO mid;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', mid);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_admin_list_custom_modules(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_admin_upsert_custom_module(uuid, text, uuid, text, text, text, integer, boolean, text) TO anon, authenticated;

