-- One-time ICBI PM email the first time Manpower Cal assigns crew to a JobFlow
-- project whose Startup "Budget enter FSI" item is still off.
-- Independent of tracker digest cron / Send now.

create extension if not exists pg_net;

create table if not exists public.manpower_fsi_budget_alerts (
  project_id uuid primary key references public.projects(id) on delete cascade,
  job_label text not null default '',
  pm_email text,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'skipped', 'error')),
  skip_reason text,
  last_error text,
  attempt_count integer not null default 0,
  queued_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists manpower_fsi_budget_alerts_status_idx
  on public.manpower_fsi_budget_alerts (status, queued_at);

alter table public.manpower_fsi_budget_alerts enable row level security;

drop policy if exists manpower_fsi_budget_alerts_deny on public.manpower_fsi_budget_alerts;
create policy manpower_fsi_budget_alerts_deny
  on public.manpower_fsi_budget_alerts
  for all using (false) with check (false);

revoke all on table public.manpower_fsi_budget_alerts from public, anon, authenticated;

-- Job names encoded in a Manpower Cal cell (plain job, Night:, AM/PM transfer, training-for).
create or replace function manpower_api.assignment_cell_job_labels(p_cell text)
returns setof text
language plpgsql
stable
set search_path = public, manpower_api
as $$
declare
  v text := btrim(coalesce(p_cell, ''));
  am text;
  pm text;
  training text;
begin
  if v = '' or lower(v) = 'none' then
    return;
  end if;

  if exists (
    select 1
    from public.manpower_assignment_statuses s
    where lower(btrim(s.name)) = lower(v)
  ) then
    return;
  end if;

  if v ~* '\|for:' then
    training := btrim(substring(v from '(?i)\|for:\s*(.*)$'));
    if training <> '' then
      return next training;
    end if;
    return;
  end if;

  if v ~* '^AM:\s*.+\s*/\s*PM:\s*.+' then
    am := btrim(substring(v from '(?i)^AM:\s*(.*?)\s*/\s*PM:'));
    pm := btrim(substring(v from '(?i)/\s*PM:\s*(.*)$'));
    if am <> '' then
      return next am;
    end if;
    if pm <> '' then
      return next pm;
    end if;
    return;
  end if;

  if v ~* '^Night:\s*' then
    return next btrim(substring(v from '(?i)^Night:\s*(.*)$'));
    return;
  end if;

  return next v;
end;
$$;

create or replace function manpower_api.projects_for_assignment_cell(p_week_id uuid, p_cell text)
returns table (project_id uuid, job_label text)
language sql
stable
set search_path = public, manpower_api
as $$
  with labels as (
    select distinct btrim(lab) as lab
    from manpower_api.assignment_cell_job_labels(p_cell) as lab
    where btrim(lab) <> ''
  )
  select distinct x.project_id, x.job_label
  from (
    select
      p.id as project_id,
      btrim(coalesce(p.job_number, '') || ' ' || coalesce(p.job_name, '')) as job_label
    from labels l
    join public.projects p
      on lower(btrim(coalesce(p.job_number, '') || ' ' || coalesce(p.job_name, ''))) = lower(l.lab)
    union all
    select j.project_id, btrim(j.name) as job_label
    from labels l
    join public.manpower_jobs j
      on j.week_id = p_week_id
     and lower(btrim(j.name)) = lower(l.lab)
     and j.project_id is not null
  ) x
  where x.project_id is not null
    and btrim(coalesce(x.job_label, '')) <> '';
$$;

-- null = FSI is enabled and incomplete (send). Otherwise a skip reason.
create or replace function manpower_api.budget_enter_fsi_alert_reason(p_data jsonb)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_item jsonb;
begin
  select item
  into v_item
  from jsonb_array_elements(coalesce(p_data->'startup_items'->'items', '[]'::jsonb)) item
  where item->>'id' = 'budget_enter_fsi'
  limit 1;

  if v_item is null then
    return null;
  end if;

  if coalesce((v_item->>'enabled')::boolean, true) = false then
    return 'fsi_disabled';
  end if;

  if coalesce((v_item->>'complete')::boolean, false) then
    return 'fsi_complete';
  end if;

  return null;
end;
$$;

create or replace function public.manpower_invoke_fsi_budget_alerts()
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
begin
  if not exists (
    select 1
    from public.manpower_fsi_budget_alerts a
    where a.status in ('queued', 'error')
      and a.sent_at is null
      and a.attempt_count < 5
  ) then
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
    url := rtrim(v_url, '/') || '/functions/v1/manpower-fsi-budget-alert',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_anon,
      'Authorization', 'Bearer ' || v_anon
    ),
    body := jsonb_build_object('secret', v_secret),
    timeout_milliseconds := 60000
  ) into v_id;

  return v_id;
end;
$$;

revoke all on function public.manpower_invoke_fsi_budget_alerts() from public, anon, authenticated;
grant execute on function public.manpower_invoke_fsi_budget_alerts() to postgres;

create or replace function manpower_api.maybe_queue_fsi_budget_alert(
  p_week_id uuid,
  p_employee_id uuid,
  p_day_key text,
  p_cell text
)
returns void
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  rec record;
  v_pm text;
  v_reason text;
  v_prior boolean;
  v_should_invoke boolean := false;
begin
  if btrim(coalesce(p_cell, '')) = '' then
    return;
  end if;

  for rec in
    select distinct pfc.project_id, pfc.job_label
    from manpower_api.projects_for_assignment_cell(p_week_id, p_cell) pfc
  loop
    if exists (
      select 1
      from public.manpower_fsi_budget_alerts a
      where a.project_id = rec.project_id
    ) then
      continue;
    end if;

    select exists (
      select 1
      from public.manpower_assignments a
      cross join lateral manpower_api.projects_for_assignment_cell(a.week_id, a.cell_value) prev
      where prev.project_id = rec.project_id
        and (a.week_id, a.employee_id, a.day_key)
            is distinct from (p_week_id, p_employee_id, p_day_key)
    ) into v_prior;

    if v_prior then
      insert into public.manpower_fsi_budget_alerts (project_id, job_label, status, skip_reason)
      values (rec.project_id, rec.job_label, 'skipped', 'already_assigned')
      on conflict (project_id) do nothing;
      continue;
    end if;

    select
      manpower_api.budget_enter_fsi_alert_reason(p.data),
      nullif(btrim(coalesce(p.data->'job_info'->>'icbi_pm_email', '')), '')
    into v_reason, v_pm
    from public.projects p
    where p.id = rec.project_id;

    if not found then
      continue;
    end if;

    if v_reason is not null then
      insert into public.manpower_fsi_budget_alerts (project_id, job_label, pm_email, status, skip_reason)
      values (rec.project_id, rec.job_label, v_pm, 'skipped', v_reason)
      on conflict (project_id) do nothing;
      continue;
    end if;

    if v_pm is null then
      insert into public.manpower_fsi_budget_alerts (project_id, job_label, status, skip_reason)
      values (rec.project_id, rec.job_label, 'skipped', 'missing_pm_email')
      on conflict (project_id) do nothing;
      continue;
    end if;

    insert into public.manpower_fsi_budget_alerts (project_id, job_label, pm_email, status)
    values (rec.project_id, rec.job_label, v_pm, 'queued')
    on conflict (project_id) do nothing;
    if found then
      v_should_invoke := true;
    end if;
  end loop;

  if v_should_invoke then
    begin
      perform public.manpower_invoke_fsi_budget_alerts();
    exception
      when others then
        null;
    end;
  end if;
end;
$$;

revoke all on function manpower_api.assignment_cell_job_labels(text) from public;
revoke all on function manpower_api.projects_for_assignment_cell(uuid, text) from public;
revoke all on function manpower_api.budget_enter_fsi_alert_reason(jsonb) from public;
revoke all on function manpower_api.maybe_queue_fsi_budget_alert(uuid, uuid, text, text) from public;

create or replace function manpower_api.set_assignment(
  p_token uuid,
  p_week_id uuid,
  p_employee_id uuid,
  p_day_key text,
  p_value text
)
returns boolean
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  s public.manpower_supers;
  old_val text := '';
  new_val text := coalesce(p_value, '');
  emp_name text;
  week_lbl text;
begin
  s := manpower_api.require_super(p_token);

  select a.cell_value
  into old_val
  from public.manpower_assignments a
  where a.week_id = p_week_id
    and a.employee_id = p_employee_id
    and a.day_key = p_day_key;

  old_val := coalesce(old_val, '');

  insert into public.manpower_assignments (week_id, employee_id, day_key, cell_value, updated_at)
  values (p_week_id, p_employee_id, p_day_key, new_val, now())
  on conflict (week_id, employee_id, day_key) do update
    set cell_value = excluded.cell_value, updated_at = now();

  if old_val is distinct from new_val then
    select e.name into emp_name from public.manpower_employees e where e.id = p_employee_id;
    select w.week_label into week_lbl from public.manpower_weeks w where w.id = p_week_id;

    insert into public.manpower_crew_audit_log (
      super_id, super_name, week_id, week_label, employee_id, employee_name, day_key, old_value, new_value
    )
    values (
      s.id,
      s.name,
      p_week_id,
      coalesce(week_lbl, '?'),
      p_employee_id,
      coalesce(emp_name, '?'),
      p_day_key,
      old_val,
      new_val
    );

    begin
      perform manpower_api.maybe_queue_fsi_budget_alert(
        p_week_id, p_employee_id, p_day_key, new_val
      );
    exception
      when others then
        null;
    end;
  end if;

  return true;
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'manpower-fsi-budget-alert-retry') then
    perform cron.unschedule('manpower-fsi-budget-alert-retry');
  end if;
  perform cron.schedule(
    'manpower-fsi-budget-alert-retry',
    '*/15 * * * *',
    $cron$select public.manpower_invoke_fsi_budget_alerts()$cron$
  );
end;
$$;

notify pgrst, 'reload schema';
