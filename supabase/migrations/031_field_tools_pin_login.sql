-- Field Tools: PIN-only login RPC + unique dev PINs for existing installs
-- Run in Supabase SQL editor if 030_field_tools.sql was already applied partially.

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

-- Unique dev PINs (skip if you already set production PINs)
UPDATE public.field_tools_profiles SET pin_hash = extensions.crypt('1234', extensions.gen_salt('bf'))
  WHERE lower(trim(name)) = lower('John Ortega');
UPDATE public.field_tools_profiles SET pin_hash = extensions.crypt('2345', extensions.gen_salt('bf'))
  WHERE lower(trim(name)) = lower('Robert Vallejo');
UPDATE public.field_tools_profiles SET pin_hash = extensions.crypt('3456', extensions.gen_salt('bf'))
  WHERE lower(trim(name)) = lower('John Kirkland');
UPDATE public.field_tools_profiles SET pin_hash = extensions.crypt('4567', extensions.gen_salt('bf'))
  WHERE lower(trim(name)) = lower('David Tenorio');
