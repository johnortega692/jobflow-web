-- A PM or admin can correct the dollar total on a Last-Min receipt.
-- The material budget uses that amount.

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
    return jsonb_build_object('ok', false, 'error', 'Only a PM or admin can change a Last-Min total.');
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

  update public.field_tools_orders
  set payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{amount}', to_jsonb(v_text), true)
  where id = p_order_id;

  return jsonb_build_object('ok', true, 'amount', v_text);
end;
$$;

revoke all on function public.jobflow_set_last_min_amount(uuid, numeric) from public, anon;
grant execute on function public.jobflow_set_last_min_amount(uuid, numeric) to authenticated;

notify pgrst, 'reload schema';
