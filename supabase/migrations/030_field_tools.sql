-- Ironwood Field Tools (field orders PWA) — profile PIN login + order storage
-- Shares JobFlow Supabase project; custom PIN auth (no Supabase Auth)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Profiles ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.field_tools_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL DEFAULT '',
  pin_hash text NOT NULL,
  role text NOT NULL DEFAULT 'foreman' CHECK (role IN ('admin', 'foreman', 'laborer')),
  modules text[] NOT NULL DEFAULT ARRAY['ordering']::text[],
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS field_tools_profiles_name_lower_idx
  ON public.field_tools_profiles (lower(trim(name)));

-- ── Jobs (manual until JobFlow sync) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.field_tools_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_number text NOT NULL,
  job_name text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  superintendent text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS field_tools_jobs_job_number_idx
  ON public.field_tools_jobs (lower(trim(job_number)));

-- ── Orders ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.field_tools_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_number text NOT NULL DEFAULT '',
  order_type text NOT NULL CHECK (order_type IN ('field_request', 'job_scope_kit')),
  phase text NOT NULL DEFAULT '',
  submitted_by_profile_id uuid REFERENCES public.field_tools_profiles (id) ON DELETE SET NULL,
  submitted_by_name text NOT NULL DEFAULT '',
  submitted_by_email text NOT NULL DEFAULT '',
  crew_kit text NOT NULL DEFAULT '',
  crew_count integer NOT NULL DEFAULT 1,
  site_contact text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  delivery_type text NOT NULL DEFAULT '',
  date_needed date,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  materials jsonb NOT NULL DEFAULT '[]'::jsonb,
  paint jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'confirmed', 'failed')),
  gas_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS field_tools_orders_job_number_idx
  ON public.field_tools_orders (job_number);
CREATE INDEX IF NOT EXISTS field_tools_orders_profile_idx
  ON public.field_tools_orders (submitted_by_profile_id, created_at DESC);

-- ── Scope library ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.field_tools_scope_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  icon text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '#2f81f7',
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.field_tools_scope_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id uuid NOT NULL REFERENCES public.field_tools_scope_library (id) ON DELETE CASCADE,
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'ea',
  default_qty numeric NOT NULL DEFAULT 1,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Crew kits ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.field_tools_crew_kits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  icon text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '#2f81f7',
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.field_tools_crew_kit_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_kit_id uuid NOT NULL REFERENCES public.field_tools_crew_kits (id) ON DELETE CASCADE,
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'ea',
  qty_per_man numeric NOT NULL DEFAULT 1,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.field_tools_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_tools_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_tools_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_tools_scope_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_tools_scope_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_tools_crew_kits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_tools_crew_kit_items ENABLE ROW LEVEL SECURITY;

-- Internal field app: anon read/write (PIN gate is app-layer; tighten later with Edge Functions)
DROP POLICY IF EXISTS field_tools_jobs_anon_all ON public.field_tools_jobs;
CREATE POLICY field_tools_jobs_anon_all ON public.field_tools_jobs
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS field_tools_orders_anon_all ON public.field_tools_orders;
CREATE POLICY field_tools_orders_anon_all ON public.field_tools_orders
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS field_tools_scope_library_anon_read ON public.field_tools_scope_library;
CREATE POLICY field_tools_scope_library_anon_read ON public.field_tools_scope_library
  FOR SELECT TO anon, authenticated USING (active = true);

DROP POLICY IF EXISTS field_tools_scope_materials_anon_read ON public.field_tools_scope_materials;
CREATE POLICY field_tools_scope_materials_anon_read ON public.field_tools_scope_materials
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS field_tools_crew_kits_anon_read ON public.field_tools_crew_kits;
CREATE POLICY field_tools_crew_kits_anon_read ON public.field_tools_crew_kits
  FOR SELECT TO anon, authenticated USING (active = true);

DROP POLICY IF EXISTS field_tools_crew_kit_items_anon_read ON public.field_tools_crew_kit_items;
CREATE POLICY field_tools_crew_kit_items_anon_read ON public.field_tools_crew_kit_items
  FOR SELECT TO anon, authenticated USING (true);

-- Profiles: no direct table access from client (use RPC)
DROP POLICY IF EXISTS field_tools_profiles_deny_anon ON public.field_tools_profiles;
CREATE POLICY field_tools_profiles_deny_anon ON public.field_tools_profiles
  FOR ALL TO anon USING (false);

-- ── RPC: PIN-only login (unique PIN per profile) ─────────────────────────
CREATE OR REPLACE FUNCTION public.field_tools_login_pin(p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  p public.field_tools_profiles%ROWTYPE;
  match_count integer;
BEGIN
  SELECT count(*)::integer INTO match_count
  FROM public.field_tools_profiles
  WHERE active = true
    AND pin_hash IS NOT NULL
    AND pin_hash = crypt(trim(p_pin), pin_hash);

  IF match_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid PIN');
  END IF;

  IF match_count > 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PIN is not unique — contact admin');
  END IF;

  SELECT * INTO p
  FROM public.field_tools_profiles
  WHERE active = true
    AND pin_hash IS NOT NULL
    AND pin_hash = crypt(trim(p_pin), pin_hash);

  RETURN jsonb_build_object(
    'ok', true,
    'profile', jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'email', p.email,
      'role', p.role,
      'modules', to_jsonb(p.modules)
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_login_pin(text) TO anon, authenticated;

-- Legacy RPC (admin tools may use profile id + pin)
CREATE OR REPLACE FUNCTION public.field_tools_list_profiles()
RETURNS TABLE (id uuid, name text, role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT p.id, p.name, p.role
  FROM public.field_tools_profiles p
  WHERE p.active = true
  ORDER BY p.name;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_list_profiles() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.field_tools_login(p_profile_id uuid, p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  p public.field_tools_profiles%ROWTYPE;
BEGIN
  SELECT * INTO p
  FROM public.field_tools_profiles
  WHERE id = p_profile_id AND active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Profile not found');
  END IF;

  IF p.pin_hash IS NULL OR p.pin_hash <> crypt(trim(p_pin), p.pin_hash) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid PIN');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'profile', jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'email', p.email,
      'role', p.role,
      'modules', to_jsonb(p.modules)
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_login(uuid, text) TO anon, authenticated;

-- ── Seed profiles (unique dev PINs — change before production) ───────────
INSERT INTO public.field_tools_profiles (name, email, pin_hash, role, modules)
SELECT v.name, v.email, crypt(v.pin, gen_salt('bf')), v.role, v.modules
FROM (VALUES
  ('John Ortega', 'jortega@ironwoodcb.com', '1234', 'admin', ARRAY['ordering', 'admin']::text[]),
  ('Robert Vallejo', 'rvallejo@ironwoodcb.com', '2345', 'foreman', ARRAY['ordering']::text[]),
  ('John Kirkland', 'jkirkland@ironwoodcb.com', '3456', 'foreman', ARRAY['ordering']::text[]),
  ('David Tenorio', 'dtenorio@ironwoodcb.com', '4567', 'foreman', ARRAY['ordering']::text[])
) AS v(name, email, pin, role, modules)
WHERE NOT EXISTS (SELECT 1 FROM public.field_tools_profiles LIMIT 1);

INSERT INTO public.field_tools_scope_library (name, icon, color, sort_order)
SELECT v.name, v.icon, v.color, v.sort_order
FROM (VALUES
  ('Gyp Ceiling', '▢', '#2f81f7', 1),
  ('Open Ceiling', '▤', '#3fb950', 2),
  ('Walls Interior', '▥', '#d29922', 3),
  ('Exterior', '◫', '#f85149', 4),
  ('Wallcovering', '▦', '#a371f7', 5),
  ('Doors and Frames', '▣', '#58a6ff', 6),
  ('Epoxy Floor', '▧', '#39d353', 7),
  ('Stairwell', '▨', '#ff7b72', 8)
) AS v(name, icon, color, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.field_tools_scope_library LIMIT 1);

INSERT INTO public.field_tools_crew_kits (name, icon, color, sort_order)
SELECT v.name, v.icon, v.color, v.sort_order
FROM (VALUES
  ('One Man Setup', '1', '#2f81f7', 1),
  ('Sprayer Setup', 'S', '#3fb950', 2),
  ('Roller Setup', 'R', '#d29922', 3)
) AS v(name, icon, color, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.field_tools_crew_kits LIMIT 1);
