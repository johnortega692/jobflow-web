-- A PM or admin can record paint gallons on a Last-Min receipt.
-- Those gallons are stored like a field order line so the paint estimate counts them.
-- The receipt dollar amount is left as entered.

create or replace function public.jobflow_set_last_min_paint(p_order_id uuid, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path to public
as $$
declare
  v_order public.field_tools_orders%rowtype;
  v_line jsonb;
  v_product text;
  v_sheen text;
  v_gallons_text text;
  v_gallons numeric;
  v_quantity text;
  v_raw text;
  v_store text;
  v_item jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_raws jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_key text;
begin
  if auth.uid() is null or not public.is_approved_user(auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'Sign in required');
  end if;
  if not public.is_app_admin(auth.uid()) and not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(btrim(coalesce(p.job_role, ''))) = 'pm'
  ) then
    return jsonb_build_object('ok', false, 'error', 'Only a PM or admin can enter paint on a Last-Min.');
  end if;
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'error', 'Order id required');
  end if;
  if p_lines is not null and jsonb_typeof(p_lines) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'error', 'Enter paint gallons as a list.');
  end if;
  if coalesce(jsonb_array_length(p_lines), 0) > 40 then
    return jsonb_build_object('ok', false, 'error', 'Too many paint lines.');
  end if;

  select * into v_order
  from public.field_tools_orders
  where id = p_order_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Order not found');
  end if;
  if v_order.order_type is distinct from 'last_min' then
    return jsonb_build_object('ok', false, 'error', 'Paint gallons can only be entered on a Last-Min.');
  end if;
  if coalesce(v_order.status, '') in ('failed', 'cancelled', 'canceled') then
    return jsonb_build_object('ok', false, 'error', 'This order is cancelled.');
  end if;

  v_store := btrim(coalesce(v_order.payload ->> 'storeName', ''));

  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    if jsonb_typeof(v_line) is distinct from 'object' then
      return jsonb_build_object('ok', false, 'error', 'Enter paint gallons as a list.');
    end if;
    v_product := btrim(coalesce(v_line ->> 'product', ''));
    v_sheen := btrim(coalesce(v_line ->> 'sheen', ''));
    v_gallons_text := btrim(coalesce(v_line ->> 'gallons', ''));
    if v_product = '' or char_length(v_product) > 80 or char_length(v_sheen) > 40 then
      return jsonb_build_object('ok', false, 'error', 'Enter a paint product.');
    end if;
    if v_gallons_text !~ '^[0-9]+(\.[0-9]+)?$' then
      return jsonb_build_object('ok', false, 'error', 'Enter gallons as a number.');
    end if;
    v_gallons := round(v_gallons_text::numeric, 2);
    if v_gallons <= 0 or v_gallons > 9999 then
      return jsonb_build_object('ok', false, 'error', 'Enter gallons as a number.');
    end if;
    v_key := lower(v_product) || '|' || lower(v_sheen);
    if v_key = any (v_seen) then
      return jsonb_build_object('ok', false, 'error', 'Enter each product once.');
    end if;
    v_seen := v_seen || v_key;

    if v_gallons = trunc(v_gallons) then
      v_quantity := trunc(v_gallons)::integer::text || ' gals';
    else
      v_quantity := regexp_replace(trim(to_char(v_gallons, 'FM9990.00')), '\.?0+$', '') || ' gals';
    end if;
    v_raw := v_quantity || ' ' || v_product;
    if v_sheen <> '' then
      v_raw := v_raw || ' (' || v_sheen || ')';
    end if;
    v_item := jsonb_strip_nulls(jsonb_build_object(
      'name', v_product,
      'detail', nullif(v_sheen, ''),
      'quantity', v_quantity,
      'raw', v_raw,
      'vendor', nullif(v_store, '')
    ));
    v_lines := v_lines || jsonb_build_array(v_item);
    v_raws := v_raws || jsonb_build_array(v_raw);
  end loop;

  update public.field_tools_orders
  set paint = v_raws,
      payload = case
        when jsonb_typeof(payload -> 'lists') = 'object' then jsonb_set(payload, '{lists,paint}', v_lines, true)
        else jsonb_set(
          coalesce(payload, '{}'::jsonb),
          '{lists}',
          jsonb_build_object('paint', v_lines),
          true
        )
      end
  where id = p_order_id;

  return jsonb_build_object('ok', true, 'lines', v_lines);
end;
$$;

revoke all on function public.jobflow_set_last_min_paint(uuid, jsonb) from public, anon;
grant execute on function public.jobflow_set_last_min_paint(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
