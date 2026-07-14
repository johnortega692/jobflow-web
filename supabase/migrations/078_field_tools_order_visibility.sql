-- Hide/show Field Tools order history when a project is hidden from field apps.

create or replace function public.field_tools_order_job_code(p_job_number text)
returns text
language sql
immutable
as $$
  select lower(trim(split_part(trim(coalesce(p_job_number, '')), ' ', 1)));
$$;

create or replace function public.field_tools_job_number_hidden(p_job_number text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    cross join lateral public.project_field_tools_job_numbers(p.job_number, p.data) n
    where trim(n) <> ''
      and (
        lower(trim(n)) = public.field_tools_order_job_code(p_job_number)
        or lower(trim(n)) = lower(trim(coalesce(p_job_number, '')))
      )
      and public.project_hidden_from_field_apps(p.id)
  );
$$;

revoke all on function public.field_tools_job_number_hidden(text) from public;

create or replace function public.field_tools_list_orders(
  p_caller_id uuid,
  p_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_orders jsonb;
begin
  perform public.field_tools_require_session(p_caller_id, p_session_token);

  select role into v_role
  from public.field_tools_profiles
  where id = p_caller_id and active = true;

  select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at desc), '[]'::jsonb)
  into v_orders
  from public.field_tools_orders o
  where (v_role in ('admin', 'super') or o.submitted_by_profile_id = p_caller_id)
    and not public.field_tools_job_number_hidden(o.job_number);

  return jsonb_build_object('ok', true, 'orders', v_orders);
end;
$$;

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

  return jsonb_build_object('ok', true, 'order', to_jsonb(o));
end;
$$;

create or replace function public.field_tools_admin_list_orders_by_job(
  p_caller_id uuid,
  p_session_token text,
  p_job_number text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clean text;
  v_orders jsonb;
  v_job_name text;
begin
  perform public.field_tools_require_admin(p_caller_id, p_session_token);

  v_clean := split_part(trim(coalesce(p_job_number, '')), ' ', 1);
  if v_clean = '' then
    return jsonb_build_object('ok', false, 'error', 'Job number is required');
  end if;

  if public.field_tools_job_number_hidden(p_job_number) then
    return jsonb_build_object(
      'ok', true,
      'job_number', v_clean,
      'job_name', '',
      'orders', '[]'::jsonb
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'job_number', o.job_number,
        'job_name', o.job_name,
        'po_number', o.po_number,
        'order_type', o.order_type,
        'status', o.status,
        'email_status', o.email_status,
        'submitted_by_name', o.submitted_by_name,
        'submitted_by_email', o.submitted_by_email,
        'site_contact', o.site_contact,
        'notes', o.notes,
        'delivery_type', o.delivery_type,
        'date_needed', o.date_needed,
        'crew_kit', o.crew_kit,
        'crew_count', o.crew_count,
        'payload', o.payload,
        'created_at', o.created_at
      )
      order by o.created_at desc
    ),
    '[]'::jsonb
  )
  into v_orders
  from public.field_tools_orders o
  where split_part(trim(o.job_number), ' ', 1) = v_clean
     or lower(trim(o.job_number)) = lower(trim(p_job_number));

  select coalesce(nullif(trim(o.job_name), ''), '')
  into v_job_name
  from public.field_tools_orders o
  where split_part(trim(o.job_number), ' ', 1) = v_clean
     or lower(trim(o.job_number)) = lower(trim(p_job_number))
  order by o.created_at desc
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'job_number', v_clean,
    'job_name', coalesce(v_job_name, ''),
    'orders', v_orders
  );
end;
$$;

drop policy if exists field_tools_orders_authenticated_read on public.field_tools_orders;
create policy field_tools_orders_authenticated_read on public.field_tools_orders
  for select to authenticated
  using (not public.field_tools_job_number_hidden(job_number));

drop policy if exists field_tools_order_dispatches_authenticated_read on public.field_tools_order_dispatches;
create policy field_tools_order_dispatches_authenticated_read on public.field_tools_order_dispatches
  for select to authenticated
  using (
    exists (
      select 1
      from public.field_tools_orders o
      where o.id = order_id
        and not public.field_tools_job_number_hidden(o.job_number)
    )
  );

notify pgrst, 'reload schema';
