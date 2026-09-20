alter table public.field_tools_order_settings
  add column if not exists receipt_reminder_enabled boolean not null default true,
  add column if not exists receipt_reminder_on_submit boolean not null default true,
  add column if not exists receipt_reminder_followup boolean not null default true,
  add column if not exists receipt_reminder_max_count integer not null default 2,
  add column if not exists receipt_reminder_cc_pm boolean not null default true;

alter table public.field_tools_order_settings
  drop constraint if exists field_tools_order_settings_receipt_reminder_max_count_chk;

alter table public.field_tools_order_settings
  add constraint field_tools_order_settings_receipt_reminder_max_count_chk
  check (receipt_reminder_max_count between 1 and 5);

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

create or replace function public.field_tools_admin_upsert_receipt_reminder_settings(
  p_caller_id uuid,
  p_session_token text,
  p_enabled boolean,
  p_on_submit boolean,
  p_followup boolean,
  p_max_count integer,
  p_cc_pm boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max integer := coalesce(p_max_count, 2);
begin
  perform public.field_tools_require_admin(p_caller_id, p_session_token);
  if v_max < 1 or v_max > 5 then
    return jsonb_build_object('ok', false, 'error', 'Max reminders must be between 1 and 5.');
  end if;

  insert into public.field_tools_order_settings (
    id,
    receipt_reminder_enabled,
    receipt_reminder_on_submit,
    receipt_reminder_followup,
    receipt_reminder_max_count,
    receipt_reminder_cc_pm,
    updated_at
  )
  values (1, coalesce(p_enabled, true), coalesce(p_on_submit, true), coalesce(p_followup, true), v_max, coalesce(p_cc_pm, true), now())
  on conflict (id) do update set
    receipt_reminder_enabled = excluded.receipt_reminder_enabled,
    receipt_reminder_on_submit = excluded.receipt_reminder_on_submit,
    receipt_reminder_followup = excluded.receipt_reminder_followup,
    receipt_reminder_max_count = excluded.receipt_reminder_max_count,
    receipt_reminder_cc_pm = excluded.receipt_reminder_cc_pm,
    updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.field_tools_admin_upsert_receipt_reminder_settings(uuid, text, boolean, boolean, boolean, integer, boolean)
  to anon, authenticated;

create or replace function public.field_tools_invoke_receipt_reminders()
returns bigint
language plpgsql
security definer
set search_path = public, net
as $$
declare
  v_secret text;
  v_url text;
  v_anon text;
  v_id bigint;
  v_local timestamp;
  v_enabled boolean;
  v_followup boolean;
begin
  select coalesce(s.receipt_reminder_enabled, true), coalesce(s.receipt_reminder_followup, true)
    into v_enabled, v_followup
  from public.field_tools_order_settings s
  where s.id = 1;
  if v_enabled is not true or v_followup is not true then
    return 0;
  end if;

  v_local := timezone('America/Los_Angeles', now());
  if extract(hour from v_local)::integer <> 8 then
    return 0;
  end if;

  select s.cron_secret into v_secret
  from public.field_tools_link_settings s
  where s.id = 1;
  if v_secret is null or btrim(v_secret) = '' then
    raise exception 'field_tools_link_settings.cron_secret is missing';
  end if;

  select ds.decrypted_secret into v_url
  from vault.decrypted_secrets ds
  where ds.name = 'project_url'
  limit 1;
  select ds.decrypted_secret into v_anon
  from vault.decrypted_secrets ds
  where ds.name = 'publishable_key'
  limit 1;
  if v_url is null or btrim(v_url) = '' or v_anon is null or btrim(v_anon) = '' then
    raise exception 'vault secrets project_url and publishable_key are required';
  end if;

  select net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/field-tools-order-receipts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_anon,
      'Authorization', 'Bearer ' || v_anon
    ),
    body := jsonb_build_object('action', 'remind_missing', 'secret', v_secret),
    timeout_milliseconds := 180000
  ) into v_id;

  return v_id;
end;
$$;

notify pgrst, 'reload schema';
