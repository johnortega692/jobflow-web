-- Jobs listed here (comma-separated codes) skip the Always CC list on outgoing orders.

alter table public.field_tools_order_settings
  add column if not exists global_cc_skip_job_codes text not null default '1058';

drop function if exists public.field_tools_admin_upsert_order_settings(uuid, text, text, text, integer);

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
        'global_cc_emails', coalesce(s.global_cc_emails, ''),
        'global_cc_skip_job_codes', coalesce(s.global_cc_skip_job_codes, ''),
        'po_seq_digits', coalesce(s.po_seq_digits, 3),
        'updated_at', s.updated_at
      )
      from public.field_tools_order_settings s
      where s.id = 1
    )
  );
end;
$$;

create or replace function public.field_tools_admin_upsert_order_settings(
  p_caller_id uuid,
  p_session_token text,
  p_warehouse_email text,
  p_global_cc_emails text default '',
  p_po_seq_digits integer default null,
  p_global_cc_skip_job_codes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  warehouse text := lower(trim(coalesce(p_warehouse_email, '')));
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
    id, warehouse_email, global_cc_emails, po_seq_digits, global_cc_skip_job_codes, updated_at
  )
  values (1, warehouse, global_norm, digits, skip_norm, now())
  on conflict (id) do update set
    warehouse_email = excluded.warehouse_email,
    global_cc_emails = excluded.global_cc_emails,
    po_seq_digits = excluded.po_seq_digits,
    global_cc_skip_job_codes = excluded.global_cc_skip_job_codes,
    updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.field_tools_admin_upsert_order_settings(uuid, text, text, text, integer, text)
  to anon, authenticated;

notify pgrst, 'reload schema';
