-- Save-on-submit recovery: idempotent client_submit_id, retry metadata, admin attention queue.

alter table public.field_tools_orders
  add column if not exists client_submit_id uuid,
  add column if not exists dispatch_specs jsonb not null default '[]'::jsonb,
  add column if not exists last_submit_error text not null default '';

create unique index if not exists field_tools_orders_client_submit_id_uidx
  on public.field_tools_orders (client_submit_id)
  where client_submit_id is not null;

create index if not exists field_tools_orders_attention_idx
  on public.field_tools_orders (created_at desc)
  where status is distinct from 'confirmed';

create or replace function public.field_tools_get_order(
  p_caller_id uuid,
  p_session_token text,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  o public.field_tools_orders%rowtype;
  v_dispatches jsonb;
begin
  perform public.field_tools_require_session(p_caller_id, p_session_token);

  if p_order_id is null then
    return jsonb_build_object('ok', false, 'error', 'Order id required');
  end if;

  select role into v_role
  from public.field_tools_profiles
  where id = p_caller_id and active = true;

  select * into o from public.field_tools_orders where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Order not found');
  end if;

  if public.field_tools_job_number_hidden(o.job_number) then
    return jsonb_build_object('ok', false, 'error', 'Order not found');
  end if;

  if v_role not in ('admin', 'super') and o.submitted_by_profile_id is distinct from p_caller_id then
    return jsonb_build_object('ok', false, 'error', 'Access denied');
  end if;

  select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at), '[]'::jsonb)
  into v_dispatches
  from public.field_tools_order_dispatches d
  where d.order_id = o.id;

  return jsonb_build_object(
    'ok', true,
    'order', to_jsonb(o) || jsonb_build_object('dispatches', v_dispatches)
  );
end;
$$;

create or replace function public.field_tools_admin_list_attention_orders(
  p_caller_id uuid,
  p_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orders jsonb;
begin
  perform public.field_tools_require_admin(p_caller_id, p_session_token);

  select coalesce(
    jsonb_agg(q.row_data order by q.created_at desc),
    '[]'::jsonb
  )
  into v_orders
  from (
    select
      o.created_at,
      to_jsonb(o) || jsonb_build_object(
        'dispatches', coalesce((
          select jsonb_agg(to_jsonb(d) order by d.created_at)
          from public.field_tools_order_dispatches d
          where d.order_id = o.id
        ), '[]'::jsonb)
      ) as row_data
    from public.field_tools_orders o
    where o.status is distinct from 'confirmed'
       or o.email_status in ('failed', 'partial')
       or (o.email_status = 'pending' and o.created_at < now() - interval '2 minutes')
    order by o.created_at desc
    limit 100
  ) q;

  return jsonb_build_object('ok', true, 'orders', v_orders);
end;
$$;

grant execute on function public.field_tools_admin_list_attention_orders(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
