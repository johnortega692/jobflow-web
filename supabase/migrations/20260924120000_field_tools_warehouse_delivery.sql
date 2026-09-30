-- Warehouse delivery address for Field Request "Deliver to Warehouse",
-- plus optional CC of warehouse email on those orders.

alter table public.field_tools_order_settings
  add column if not exists warehouse_address text not null default '',
  add column if not exists warehouse_delivery_cc boolean not null default false;

create or replace function public.field_tools_admin_get_order_settings(
  p_caller_id uuid,
  p_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.field_tools_require_admin(p_caller_id, p_session_token);
  return jsonb_build_object(
    'ok', true,
    'settings', (
      select jsonb_build_object(
        'warehouse_email', coalesce(s.warehouse_email, ''),
        'warehouse_address', coalesce(s.warehouse_address, ''),
        'warehouse_delivery_cc', coalesce(s.warehouse_delivery_cc, false),
        'global_cc_emails', coalesce(s.global_cc_emails, ''),
        'global_cc_skip_job_codes', coalesce(s.global_cc_skip_job_codes, ''),
        'po_seq_digits', coalesce(s.po_seq_digits, 3),
        'receipt_reminder_enabled', coalesce(s.receipt_reminder_enabled, true),
        'receipt_reminder_on_submit', coalesce(s.receipt_reminder_on_submit, true),
        'receipt_reminder_followup', coalesce(s.receipt_reminder_followup, true),
        'receipt_reminder_max_count', coalesce(s.receipt_reminder_max_count, 2),
        'receipt_reminder_cc_pm', coalesce(s.receipt_reminder_cc_pm, true),
        'updated_at', s.updated_at
      )
      from public.field_tools_order_settings s
      where s.id = 1
    )
  );
end;
$$;

drop function if exists public.field_tools_admin_upsert_order_settings(uuid, text, text, text, integer, text);

create or replace function public.field_tools_admin_upsert_order_settings(
  p_caller_id uuid,
  p_session_token text,
  p_warehouse_email text,
  p_global_cc_emails text default '',
  p_po_seq_digits integer default null,
  p_global_cc_skip_job_codes text default '',
  p_warehouse_address text default '',
  p_warehouse_delivery_cc boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  warehouse text := lower(trim(coalesce(p_warehouse_email, '')));
  warehouse_addr text := trim(coalesce(p_warehouse_address, ''));
  global_raw text := trim(coalesce(p_global_cc_emails, ''));
  global_norm text := '';
  skip_raw text := trim(coalesce(p_global_cc_skip_job_codes, ''));
  skip_norm text := '';
  part text;
  parts text[];
  i int;
  digits smallint;
begin
  perform public.field_tools_require_admin(p_caller_id, p_session_token);

  if warehouse <> '' and warehouse !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'error', 'Enter a valid warehouse email address.');
  end if;

  if global_raw <> '' then
    parts := regexp_split_to_array(global_raw, '[,;]');
    for i in 1..coalesce(array_length(parts, 1), 0) loop
      part := lower(trim(parts[i]));
      if part = '' then
        continue;
      end if;
      if part !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        return jsonb_build_object('ok', false, 'error', 'Enter valid email addresses for Always CC (comma-separated).');
      end if;
      if global_norm <> '' then
        global_norm := global_norm || ',';
      end if;
      global_norm := global_norm || part;
    end loop;
  end if;

  if skip_raw <> '' then
    parts := regexp_split_to_array(skip_raw, '[,;]');
    for i in 1..coalesce(array_length(parts, 1), 0) loop
      part := upper(trim(split_part(trim(parts[i]), ' ', 1)));
      if part = '' then
        continue;
      end if;
      if skip_norm <> '' then
        skip_norm := skip_norm || ',';
      end if;
      skip_norm := skip_norm || part;
    end loop;
  end if;

  digits := coalesce(p_po_seq_digits, (select po_seq_digits from public.field_tools_order_settings where id = 1), 3);
  if digits < 1 or digits > 6 then
    return jsonb_build_object('ok', false, 'error', 'PO sequence digits must be between 1 and 6.');
  end if;

  insert into public.field_tools_order_settings (
    id,
    warehouse_email,
    warehouse_address,
    warehouse_delivery_cc,
    global_cc_emails,
    po_seq_digits,
    global_cc_skip_job_codes,
    updated_at
  )
  values (
    1,
    warehouse,
    warehouse_addr,
    coalesce(p_warehouse_delivery_cc, false),
    global_norm,
    digits,
    skip_norm,
    now()
  )
  on conflict (id) do update set
    warehouse_email = excluded.warehouse_email,
    warehouse_address = excluded.warehouse_address,
    warehouse_delivery_cc = excluded.warehouse_delivery_cc,
    global_cc_emails = excluded.global_cc_emails,
    po_seq_digits = excluded.po_seq_digits,
    global_cc_skip_job_codes = excluded.global_cc_skip_job_codes,
    updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.field_tools_admin_upsert_order_settings(uuid, text, text, text, integer, text, text, boolean)
  to anon, authenticated;

-- Append warehouse delivery fields to the order catalog JSON for field clients.
do $$
declare
  src text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'field_tools_get_order_catalog'
  limit 1;

  if position('warehouse_address' in src) > 0 then
    return;
  end if;

  patched := replace(
    src,
    '''warehouse_email'', coalesce((SELECT s.warehouse_email FROM public.field_tools_order_settings s WHERE s.id = 1), ''''),',
    '''warehouse_email'', coalesce((SELECT s.warehouse_email FROM public.field_tools_order_settings s WHERE s.id = 1), ''''),
    ''warehouse_address'', coalesce((SELECT s.warehouse_address FROM public.field_tools_order_settings s WHERE s.id = 1), ''''),
    ''warehouse_delivery_cc'', coalesce((SELECT s.warehouse_delivery_cc FROM public.field_tools_order_settings s WHERE s.id = 1), false),'
  );

  if patched = src then
    raise exception 'Catalog patch did not match warehouse_email line';
  end if;

  execute patched;
end;
$$;

notify pgrst, 'reload schema';
