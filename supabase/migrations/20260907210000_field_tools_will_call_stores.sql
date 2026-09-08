-- Will-call pickup locations (map pins). Separate from field_tools_vendor_stores (email CC).

CREATE TABLE IF NOT EXISTS public.field_tools_stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.field_tools_vendors(id) ON DELETE CASCADE,
  store_number text,
  name text NOT NULL,
  address text NOT NULL DEFAULT '',
  city text,
  phone text,
  hours text,
  lat numeric NOT NULL,
  lng numeric NOT NULL,
  will_call boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS field_tools_stores_vendor_active_idx
  ON public.field_tools_stores (vendor_id, active)
  WHERE active;

CREATE UNIQUE INDEX IF NOT EXISTS field_tools_stores_dedupe_idx
  ON public.field_tools_stores (
    vendor_id,
    lower(trim(name)),
    lower(trim(address))
  );

ALTER TABLE public.field_tools_stores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS field_tools_stores_deny ON public.field_tools_stores;
CREATE POLICY field_tools_stores_deny ON public.field_tools_stores
  FOR ALL USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.field_tools_list_will_call_stores(
  p_caller_id uuid,
  p_session_token text,
  p_vendor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);
  IF p_vendor_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', s.id,
      'vendor_id', s.vendor_id,
      'store_number', s.store_number,
      'name', s.name,
      'address', s.address,
      'city', s.city,
      'phone', s.phone,
      'hours', s.hours,
      'lat', s.lat,
      'lng', s.lng,
      'verified', s.verified
    ) ORDER BY s.name)
    FROM public.field_tools_stores s
    WHERE s.vendor_id = p_vendor_id
      AND s.active
      AND s.will_call
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.field_tools_upsert_will_call_store(
  p_caller_id uuid,
  p_session_token text,
  p_vendor_id uuid,
  p_name text,
  p_address text,
  p_lat numeric,
  p_lng numeric,
  p_store_number text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_hours text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  store_name text := trim(coalesce(p_name, ''));
  store_address text := trim(coalesce(p_address, ''));
  existing_id uuid;
  sid uuid;
BEGIN
  PERFORM public.field_tools_require_session(p_caller_id, p_session_token);
  IF p_vendor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.field_tools_vendors v WHERE v.id = p_vendor_id AND v.active
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Vendor not found');
  END IF;
  IF store_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Store name is required');
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Store coordinates are required');
  END IF;

  SELECT s.id INTO existing_id
  FROM public.field_tools_stores s
  WHERE s.vendor_id = p_vendor_id
    AND lower(trim(s.name)) = lower(store_name)
    AND lower(trim(s.address)) = lower(store_address)
  LIMIT 1;

  IF existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'id', existing_id, 'created', false);
  END IF;

  INSERT INTO public.field_tools_stores (
    vendor_id, store_number, name, address, city, phone, hours, lat, lng, will_call, active, verified
  ) VALUES (
    p_vendor_id,
    nullif(trim(coalesce(p_store_number, '')), ''),
    store_name,
    store_address,
    nullif(trim(coalesce(p_city, '')), ''),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_hours, '')), ''),
    p_lat,
    p_lng,
    true,
    true,
    false
  )
  RETURNING id INTO sid;

  RETURN jsonb_build_object('ok', true, 'id', sid, 'created', true);
EXCEPTION WHEN unique_violation THEN
  SELECT s.id INTO existing_id
  FROM public.field_tools_stores s
  WHERE s.vendor_id = p_vendor_id
    AND lower(trim(s.name)) = lower(store_name)
    AND lower(trim(s.address)) = lower(store_address)
  LIMIT 1;
  RETURN jsonb_build_object('ok', true, 'id', existing_id, 'created', false);
WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok', false, 'error', 'INVALID_SESSION');
END;
$$;

GRANT EXECUTE ON FUNCTION public.field_tools_list_will_call_stores(uuid, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_tools_upsert_will_call_store(uuid, text, uuid, text, text, numeric, numeric, text, text, text, text) TO anon, authenticated;
