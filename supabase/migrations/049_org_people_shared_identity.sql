-- Shared org identity: one PIN per person across Field Tools and Manpower Cal

CREATE TABLE IF NOT EXISTS public.org_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  pin_hash text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.org_people ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_people_deny_anon ON public.org_people;
CREATE POLICY org_people_deny_anon ON public.org_people
  FOR ALL TO anon USING (false);

ALTER TABLE public.field_tools_profiles
  ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES public.org_people(id) ON DELETE SET NULL;

ALTER TABLE public.manpower_supers
  ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES public.org_people(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS field_tools_profiles_person_id_uidx
  ON public.field_tools_profiles (person_id)
  WHERE person_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS manpower_supers_person_id_uidx
  ON public.manpower_supers (person_id)
  WHERE person_id IS NOT NULL;

-- ── Helpers ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.org_pin_in_use(p_pin text, p_exclude_person_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_people o
    WHERE o.active
      AND o.pin_hash IS NOT NULL
      AND o.pin_hash = extensions.crypt(trim(p_pin), o.pin_hash)
      AND (p_exclude_person_id IS NULL OR o.id <> p_exclude_person_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.org_set_pin(p_person_id uuid, p_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash text;
BEGIN
  v_hash := extensions.crypt(trim(p_pin), extensions.gen_salt('bf'));
  UPDATE public.org_people
  SET pin_hash = v_hash, updated_at = now()
  WHERE id = p_person_id;

  UPDATE public.field_tools_profiles
  SET pin_hash = v_hash, updated_at = now()
  WHERE person_id = p_person_id;

  UPDATE public.manpower_supers
  SET pin_hash = v_hash, updated_at = now()
  WHERE person_id = p_person_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.org_sync_identity(
  p_person_id uuid,
  p_name text,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_active boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.org_people
  SET name = trim(p_name),
      email = coalesce(p_email, email),
      phone = coalesce(p_phone, phone),
      active = coalesce(p_active, active),
      updated_at = now()
  WHERE id = p_person_id;

  UPDATE public.field_tools_profiles
  SET name = trim(p_name),
      email = coalesce(p_email, email),
      phone = coalesce(p_phone, phone),
      active = coalesce(p_active, active),
      updated_at = now()
  WHERE person_id = p_person_id;

  UPDATE public.manpower_supers
  SET name = trim(p_name),
      active = coalesce(p_active, active),
      updated_at = now()
  WHERE person_id = p_person_id;
END;
$$;

-- ── Backfill from existing app rows ─────────────────────────────────────

INSERT INTO public.org_people (id, name, email, phone, pin_hash, active, created_at, updated_at)
SELECT p.id, p.name, coalesce(p.email, ''), coalesce(p.phone, ''), p.pin_hash, p.active, p.created_at, p.updated_at
FROM public.field_tools_profiles p
WHERE p.person_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.org_people o WHERE o.id = p.id)
ON CONFLICT (id) DO NOTHING;

UPDATE public.field_tools_profiles p
SET person_id = p.id
WHERE p.person_id IS NULL;

UPDATE public.manpower_supers ms
SET person_id = o.id
FROM public.org_people o
WHERE ms.person_id IS NULL
  AND lower(trim(ms.name)) = lower(trim(o.name));

WITH ft_first AS (
  SELECT ftp.person_id, lower(split_part(trim(ftp.name), ' ', 1)) AS first_name
  FROM public.field_tools_profiles ftp
  WHERE ftp.person_id IS NOT NULL
),
unique_first AS (
  SELECT first_name, (array_agg(person_id ORDER BY person_id))[1] AS person_id
  FROM ft_first
  GROUP BY first_name
  HAVING count(*) = 1
)
UPDATE public.manpower_supers ms
SET person_id = uf.person_id
FROM unique_first uf
WHERE ms.person_id IS NULL
  AND lower(trim(ms.name)) = uf.first_name;

-- Manpower-only users: org row uses same id as super row
INSERT INTO public.org_people (id, name, pin_hash, active, created_at, updated_at)
SELECT ms.id, ms.name, ms.pin_hash, ms.active, ms.created_at, ms.updated_at
FROM public.manpower_supers ms
WHERE ms.person_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.org_people o WHERE o.id = ms.id)
ON CONFLICT (id) DO NOTHING;

UPDATE public.manpower_supers ms
SET person_id = ms.id
WHERE ms.person_id IS NULL;

UPDATE public.field_tools_profiles ftp
SET pin_hash = o.pin_hash
FROM public.org_people o
WHERE ftp.person_id = o.id
  AND o.pin_hash IS NOT NULL
  AND ftp.pin_hash IS DISTINCT FROM o.pin_hash;

UPDATE public.manpower_supers ms
SET pin_hash = o.pin_hash
FROM public.org_people o
WHERE ms.person_id = o.id
  AND o.pin_hash IS NOT NULL
  AND ms.pin_hash IS DISTINCT FROM o.pin_hash;

-- ── Field Tools: PIN login via org_people ───────────────────────────────

CREATE OR REPLACE FUNCTION public.field_tools_login_pin(p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_person public.org_people%ROWTYPE;
  p public.field_tools_profiles%ROWTYPE;
  match_count integer;
BEGIN
  SELECT count(*)::integer INTO match_count
  FROM public.org_people o
  WHERE o.active
    AND o.pin_hash IS NOT NULL
    AND o.pin_hash = extensions.crypt(trim(p_pin), o.pin_hash);

  IF match_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid PIN');
  END IF;

  IF match_count > 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PIN is not unique — contact admin');
  END IF;

  SELECT * INTO v_person
  FROM public.org_people o
  WHERE o.active
    AND o.pin_hash IS NOT NULL
    AND o.pin_hash = extensions.crypt(trim(p_pin), o.pin_hash);

  SELECT * INTO p
  FROM public.field_tools_profiles ftp
  WHERE ftp.person_id = v_person.id
    AND ftp.active
  ORDER BY ftp.updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No Field Tools access for this PIN');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'profile', jsonb_build_object(
      'id', p.id,
      'name', v_person.name,
      'email', v_person.email,
      'phone', v_person.phone,
      'role', p.role,
      'modules', to_jsonb(p.modules),
      'custom_modules', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'id', cm.id,
          'title', cm.title,
          'description', cm.description,
          'url', cm.url,
          'sort_order', cm.sort_order
        ) ORDER BY cm.sort_order, cm.title), '[]'::jsonb)
        FROM public.field_tools_profile_custom_modules pcm
        JOIN public.field_tools_custom_modules cm ON cm.id = pcm.module_id
        WHERE pcm.profile_id = p.id AND cm.active = true
      )
    )
  );
END;
$$;

-- ── Field Tools: profile upsert writes org_people ───────────────────────

CREATE OR REPLACE FUNCTION public.field_tools_admin_upsert_profile(
  p_caller_id uuid,
  p_profile_id uuid,
  p_name text,
  p_email text,
  p_phone text,
  p_pin text,
  p_role text,
  p_active boolean DEFAULT true,
  p_modules text[] DEFAULT NULL,
  p_custom_module_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  pid uuid;
  v_person_id uuid;
  mods text[];
  mid uuid;
BEGIN
  PERFORM public.field_tools_require_admin(p_caller_id);

  IF EXISTS (
    SELECT 1 FROM public.field_tools_profiles
    WHERE id = p_caller_id AND active AND role = 'super'
  ) THEN
    IF p_role = 'admin' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Cannot assign admin role');
    END IF;
    IF p_profile_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.field_tools_profiles
      WHERE id = p_profile_id AND role = 'admin'
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Cannot edit admin profiles');
    END IF;
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Name is required');
  END IF;

  IF p_role NOT IN ('admin', 'super', 'foreman', 'laborer') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid role');
  END IF;

  mods := public.field_tools_sanitize_profile_modules(p_role, p_modules);

  IF p_profile_id IS NULL THEN
    IF p_pin IS NULL OR length(trim(p_pin)) < 4 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'PIN required (4+ digits) for new profile');
    END IF;
    IF public.org_pin_in_use(p_pin) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'PIN already in use');
    END IF;

    INSERT INTO public.org_people (name, email, phone, pin_hash, active)
    VALUES (
      trim(p_name),
      coalesce(p_email, ''),
      coalesce(p_phone, ''),
      extensions.crypt(trim(p_pin), extensions.gen_salt('bf')),
      coalesce(p_active, true)
    )
    RETURNING id INTO v_person_id;

    INSERT INTO public.field_tools_profiles (person_id, name, email, phone, pin_hash, role, modules, active)
    VALUES (
      v_person_id,
      trim(p_name),
      coalesce(p_email, ''),
      coalesce(p_phone, ''),
      (SELECT pin_hash FROM public.org_people WHERE id = v_person_id),
      p_role,
      mods,
      coalesce(p_active, true)
    )
    RETURNING id INTO pid;
  ELSE
    SELECT ftp.person_id INTO v_person_id
    FROM public.field_tools_profiles ftp
    WHERE ftp.id = p_profile_id;

    IF v_person_id IS NULL THEN
      INSERT INTO public.org_people (name, email, phone, pin_hash, active)
      VALUES (
        trim(p_name),
        coalesce(p_email, ''),
        coalesce(p_phone, ''),
        CASE
          WHEN p_pin IS NOT NULL AND length(trim(p_pin)) >= 4
          THEN extensions.crypt(trim(p_pin), extensions.gen_salt('bf'))
          ELSE NULL
        END,
        coalesce(p_active, true)
      )
      RETURNING id INTO v_person_id;
    END IF;

    IF p_pin IS NOT NULL AND length(trim(p_pin)) >= 4 THEN
      IF public.org_pin_in_use(p_pin, v_person_id) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'PIN already in use');
      END IF;
      PERFORM public.org_set_pin(v_person_id, p_pin);
    END IF;

    PERFORM public.org_sync_identity(v_person_id, p_name, p_email, p_phone, p_active);

    UPDATE public.field_tools_profiles SET
      person_id = v_person_id,
      role = p_role,
      modules = CASE
        WHEN p_modules IS NULL THEN modules
        ELSE mods
      END,
      updated_at = now()
    WHERE id = p_profile_id
    RETURNING id INTO pid;

    IF pid IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Profile not found');
    END IF;
  END IF;

  IF p_custom_module_ids IS NOT NULL THEN
    DELETE FROM public.field_tools_profile_custom_modules WHERE profile_id = pid;
    IF array_length(p_custom_module_ids, 1) IS NOT NULL THEN
      FOREACH mid IN ARRAY p_custom_module_ids LOOP
        IF EXISTS (SELECT 1 FROM public.field_tools_custom_modules WHERE id = mid AND active = true) THEN
          INSERT INTO public.field_tools_profile_custom_modules (profile_id, module_id)
          VALUES (pid, mid)
          ON CONFLICT DO NOTHING;
        END IF;
      END LOOP;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', pid);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
END;
$$;

-- ── Manpower: PIN login via org_people ──────────────────────────────────

CREATE OR REPLACE FUNCTION manpower_api.login(p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, manpower_api, extensions
AS $$
DECLARE
  v_person public.org_people%ROWTYPE;
  s public.manpower_supers%ROWTYPE;
  tok uuid;
  exp timestamptz;
  match_count integer;
BEGIN
  IF p_pin IS NULL OR length(trim(p_pin)) < 4 THEN
    RAISE EXCEPTION 'INVALID_PIN' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)::integer INTO match_count
  FROM public.org_people o
  WHERE o.active
    AND o.pin_hash IS NOT NULL
    AND o.pin_hash = extensions.crypt(trim(p_pin), o.pin_hash);

  IF match_count = 0 THEN
    RAISE EXCEPTION 'INVALID_PIN' USING ERRCODE = 'P0001';
  END IF;

  IF match_count > 1 THEN
    RAISE EXCEPTION 'INVALID_PIN' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_person
  FROM public.org_people o
  WHERE o.active
    AND o.pin_hash IS NOT NULL
    AND o.pin_hash = extensions.crypt(trim(p_pin), o.pin_hash);

  SELECT * INTO s
  FROM public.manpower_supers ms
  WHERE ms.person_id = v_person.id
    AND ms.active
  ORDER BY ms.is_admin DESC, ms.updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_PIN' USING ERRCODE = 'P0001';
  END IF;

  exp := now() + interval '12 hours';
  INSERT INTO public.manpower_sessions (super_id, expires_at)
  VALUES (s.id, exp)
  RETURNING token INTO tok;

  RETURN jsonb_build_object(
    'token', tok,
    'expires_at', exp,
    'super', jsonb_build_object(
      'id', s.id,
      'name', v_person.name,
      'is_admin', s.is_admin,
      'supervisor_label', s.supervisor_label
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION manpower_api.admin_upsert_super(
  p_token uuid,
  p_name text,
  p_pin text,
  p_supervisor_label text DEFAULT NULL,
  p_is_admin boolean DEFAULT false,
  p_super_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, manpower_api, extensions
AS $$
DECLARE
  sid uuid;
  v_person_id uuid;
BEGIN
  PERFORM manpower_api.require_admin(p_token);

  IF p_super_id IS NULL THEN
    IF p_pin IS NULL OR length(trim(p_pin)) < 4 THEN
      RAISE EXCEPTION 'PIN_REQUIRED' USING ERRCODE = 'P0001';
    END IF;

    SELECT o.id INTO v_person_id
    FROM public.org_people o
    WHERE lower(trim(o.name)) = lower(trim(p_name))
    LIMIT 1;

    IF v_person_id IS NULL THEN
      IF public.org_pin_in_use(p_pin) THEN
        RAISE EXCEPTION 'PIN_IN_USE' USING ERRCODE = 'P0001';
      END IF;
      INSERT INTO public.org_people (name, pin_hash, active)
      VALUES (trim(p_name), extensions.crypt(trim(p_pin), extensions.gen_salt('bf')), true)
      RETURNING id INTO v_person_id;
    ELSE
      IF public.org_pin_in_use(p_pin, v_person_id) THEN
        RAISE EXCEPTION 'PIN_IN_USE' USING ERRCODE = 'P0001';
      END IF;
      PERFORM public.org_set_pin(v_person_id, p_pin);
      PERFORM public.org_sync_identity(v_person_id, p_name, NULL, NULL, true);
    END IF;

    INSERT INTO public.manpower_supers (person_id, name, pin_hash, supervisor_label, is_admin)
    VALUES (
      v_person_id,
      trim(p_name),
      (SELECT pin_hash FROM public.org_people WHERE id = v_person_id),
      p_supervisor_label,
      coalesce(p_is_admin, false)
    )
    RETURNING id INTO sid;
  ELSE
    SELECT ms.person_id INTO v_person_id
    FROM public.manpower_supers ms
    WHERE ms.id = p_super_id;

    IF v_person_id IS NULL THEN
      INSERT INTO public.org_people (name, pin_hash, active)
      VALUES (
        trim(p_name),
        CASE
          WHEN p_pin IS NOT NULL AND length(trim(p_pin)) >= 4
          THEN extensions.crypt(trim(p_pin), extensions.gen_salt('bf'))
          ELSE NULL
        END,
        true
      )
      RETURNING id INTO v_person_id;
    END IF;

    IF p_pin IS NOT NULL AND length(trim(p_pin)) >= 4 THEN
      IF public.org_pin_in_use(p_pin, v_person_id) THEN
        RAISE EXCEPTION 'PIN_IN_USE' USING ERRCODE = 'P0001';
      END IF;
      PERFORM public.org_set_pin(v_person_id, p_pin);
    END IF;

    PERFORM public.org_sync_identity(v_person_id, p_name, NULL, NULL, NULL);

    UPDATE public.manpower_supers
    SET person_id = v_person_id,
        supervisor_label = p_supervisor_label,
        is_admin = coalesce(p_is_admin, is_admin),
        updated_at = now()
    WHERE id = p_super_id
    RETURNING id INTO sid;
  END IF;

  RETURN sid;
END;
$$;

NOTIFY pgrst, 'reload schema';
