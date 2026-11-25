-- Keep the submitted Last-Min total when an admin sets the invoice amount.

update public.field_tools_orders
set payload = jsonb_set(
  payload,
  '{placedAmount}',
  to_jsonb(btrim(payload ->> 'amount')),
  true
)
where order_type = 'last_min'
  and nullif(btrim(coalesce(payload ->> 'placedAmount', '')), '') is null
  and nullif(btrim(coalesce(payload ->> 'amount', '')), '') is not null;

create or replace function public.jobflow_set_last_min_amount(p_order_id uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path to public
as $$
declare
  v_order public.field_tools_orders%rowtype;
  v_amount numeric;
  v_text text;
  v_placed text;
begin
  if auth.uid() is null or not public.is_approved_user(auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'Sign in required');
  end if;
  if not public.is_app_admin(auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'Only an admin can change a Last-Min total.');
  end if;
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'error', 'Order id required');
  end if;
  if p_amount is null or p_amount < 0 or p_amount > 999999.99 then
    return jsonb_build_object('ok', false, 'error', 'Enter the receipt total.');
  end if;

  select * into v_order
  from public.field_tools_orders
  where id = p_order_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Order not found');
  end if;
  if v_order.order_type is distinct from 'last_min' then
    return jsonb_build_object('ok', false, 'error', 'The total can only be changed on a Last-Min.');
  end if;
  if coalesce(v_order.status, '') in ('failed', 'cancelled', 'canceled') then
    return jsonb_build_object('ok', false, 'error', 'This order is cancelled.');
  end if;

  v_amount := round(p_amount, 2);
  v_text := to_char(v_amount, 'FM999999990.00');
  v_placed := nullif(btrim(coalesce(v_order.payload ->> 'placedAmount', '')), '');
  if v_placed is null then
    v_placed := nullif(btrim(coalesce(v_order.payload ->> 'amount', '')), '');
  end if;
  if v_placed is null then
    v_placed := v_text;
  end if;

  update public.field_tools_orders
  set payload = jsonb_set(
    jsonb_set(coalesce(payload, '{}'::jsonb), '{amount}', to_jsonb(v_text), true),
    '{placedAmount}',
    to_jsonb(v_placed),
    true
  )
  where id = p_order_id;

  return jsonb_build_object('ok', true, 'amount', v_text, 'placedAmount', v_placed);
end;
$$;
