-- Field Tools order security: session-gated reads, close anon table access,
-- revoke direct session minting, drop stale anon activity insert.

-- ── Session validation (any active profile) ─────────────────────────────

CREATE OR REPLACE FUNCTION public.field_tools_require_session(
  p_caller_id uuid,
  p_session_token text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_profile uuid;
BEGIN
  IF p_caller_id IS NULL THEN
    RAISE EXCEPTION 'SESSION_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  IF p_session_token IS NULL OR trim(p_session_token) = '' THEN
    RAISE EXCEPTION 'SESSION_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT s.profile_id INTO v_profile
  FROM public.field_tools_sessions s
  WHERE s.token_hash = encode(extensions.digest(trim(p_session_token), 'sha256'), 'hex')
    AND s.expires_at > now()
    AND s.revoked_at IS NULL;

  IF v_profile IS NULL OR v_profile <> p_caller_id THEN
    RAISE EXCEPTION 'INVALID_SESSION' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.field_tools_profiles
    WHERE id = p_caller_id AND active = true
  ) THEN
    RAISE EXCEPTION 'INVALID_SESSION' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_get_session_profile(
  p_caller_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  p public.field_tools_profiles%ROWTYPE;
  v_person public.org_people%ROWTYPE;
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);

  SELECT * INTO p
  FROM public.field_tools_profiles
  WHERE id = p_caller_id AND active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Profile not found');
  END IF;

  IF p.person_id IS NOT NULL THEN
    SELECT * INTO v_person FROM public.org_people WHERE id = p.person_id AND active = true;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'profile', jsonb_build_object(
      'id', p.id,
      'name', coalesce(nullif(trim(v_person.name), ''), nullif(trim(p.name), ''), ''),
      'email', coalesce(nullif(trim(v_person.email), ''), nullif(trim(p.email), ''), ''),
      'role', p.role
    )
  );
END;
$$;

-- ── Order reads (admin/super → all; others → own submissions) ───────────

CREATE OR REPLACE FUNCTION public.field_tools_list_orders(
  p_caller_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_orders jsonb;
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);

  SELECT role INTO v_role
  FROM public.field_tools_profiles
  WHERE id = p_caller_id AND active = true;

  SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.created_at DESC), '[]'::jsonb)
  INTO v_orders
  FROM public.field_tools_orders o
  WHERE v_role IN ('admin', 'super')
     OR o.submitted_by_profile_id = p_caller_id;

  RETURN jsonb_build_object('ok', true, 'orders', v_orders);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_get_order(
  p_caller_id uuid,
  p_session_token text,
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  o public.field_tools_orders%ROWTYPE;
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);

  IF p_order_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Order id required');
  END IF;

  SELECT role INTO v_role
  FROM public.field_tools_profiles
  WHERE id = p_caller_id AND active = true;

  SELECT * INTO o FROM public.field_tools_orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Order not found');
  END IF;

  IF v_role NOT IN ('admin', 'super') AND o.submitted_by_profile_id IS DISTINCT FROM p_caller_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Access denied');
  END IF;

  RETURN jsonb_build_object('ok', true, 'order', to_jsonb(o));
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_require_session(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_get_session_profile(uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.field_tools_list_orders(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_get_order(uuid, text, uuid) TO anon, authenticated;

-- Only login_pin (SECURITY DEFINER) may mint sessions — not public callers.
REVOKE ALL ON FUNCTION public.field_tools_issue_session(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.field_tools_issue_session(uuid) FROM anon, authenticated;

-- ── Drop blanket anon table access ──────────────────────────────────────

DROP POLICY IF EXISTS field_tools_orders_anon_all ON public.field_tools_orders;
DROP POLICY IF EXISTS field_tools_jobs_anon_all ON public.field_tools_jobs;
DROP POLICY IF EXISTS field_tools_order_dispatches_anon_all ON public.field_tools_order_dispatches;
DROP POLICY IF EXISTS "project_activity_insert_anon" ON public.project_activity;
