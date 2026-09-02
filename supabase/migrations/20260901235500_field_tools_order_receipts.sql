-- Order receipt photos in private Storage. Uploads go through a Field Tools
-- session edge function (service role). No anon/authenticated storage policies.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'field-tools-receipts',
  'field-tools-receipts',
  false,
  2097152,
  array['image/jpeg']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.field_tools_order_receipts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.field_tools_orders(id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null default 'image/jpeg',
  byte_size integer not null default 0,
  uploaded_by_profile_id uuid references public.field_tools_profiles(id) on delete set null,
  uploaded_by_name text not null default '',
  emailed_to text not null default '',
  emailed_at timestamptz,
  email_status text not null default 'pending',
  email_error text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists field_tools_order_receipts_order_idx
  on public.field_tools_order_receipts (order_id, created_at desc);

alter table public.field_tools_order_receipts enable row level security;

revoke all on table public.field_tools_order_receipts from anon, authenticated;

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

  select coalesce(jsonb_agg(q.row_data order by q.created_at desc), '[]'::jsonb)
  into v_orders
  from (
    select
      o.created_at,
      to_jsonb(o) || jsonb_build_object(
        'receipt_count', (
          select count(*)::int
          from public.field_tools_order_receipts r
          where r.order_id = o.id
        )
      ) as row_data
    from public.field_tools_orders o
    where (v_role in ('admin', 'super') or o.submitted_by_profile_id = p_caller_id)
      and not public.field_tools_job_number_hidden(o.job_number)
  ) q;

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
  v_dispatches jsonb;
  v_receipts jsonb;
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

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'order_id', r.order_id,
        'storage_path', r.storage_path,
        'mime_type', r.mime_type,
        'byte_size', r.byte_size,
        'uploaded_by_name', r.uploaded_by_name,
        'emailed_to', r.emailed_to,
        'emailed_at', r.emailed_at,
        'email_status', r.email_status,
        'created_at', r.created_at
      )
      order by r.created_at
    ),
    '[]'::jsonb
  )
  into v_receipts
  from public.field_tools_order_receipts r
  where r.order_id = o.id;

  return jsonb_build_object(
    'ok', true,
    'order', to_jsonb(o) || jsonb_build_object(
      'dispatches', v_dispatches,
      'receipts', v_receipts,
      'receipt_count', jsonb_array_length(v_receipts)
    )
  );
end;
$$;

notify pgrst, 'reload schema';
