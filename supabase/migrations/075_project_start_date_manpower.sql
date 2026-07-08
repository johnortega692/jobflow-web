-- Sync JobFlow project start date into Manpower hours tracker; supers can edit from Manpower Cal.

alter table public.manpower_hours_jobs
  add column if not exists start_date text not null default '';

create or replace function public.jobflow_project_start_date(p_data jsonb)
returns text
language sql
immutable
as $$
  select trim(coalesce(p_data->'job_info'->>'start_date', ''));
$$;

create or replace function public.sync_project_start_date_to_manpower(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_start_date text;
begin
  if uid is not null and not public.is_approved_user(uid) then
    raise exception 'Not authorized';
  end if;

  select public.jobflow_project_start_date(p.data)
  into v_start_date
  from public.projects p
  where p.id = p_project_id;

  if not found then
    raise exception 'Project not found';
  end if;

  update public.manpower_hours_jobs
  set start_date = coalesce(v_start_date, ''), updated_at = now()
  where project_id = p_project_id;
end;
$$;

revoke all on function public.sync_project_start_date_to_manpower(uuid) from public;
grant execute on function public.sync_project_start_date_to_manpower(uuid) to authenticated;

create or replace function public.set_project_job_start_date(
  p_project_id uuid,
  p_start_date text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  clean_date text := trim(coalesce(p_start_date, ''));
  v_data jsonb;
  v_job_info jsonb;
begin
  if uid is null or not public.is_approved_user(uid) then
    raise exception 'Not authorized';
  end if;

  select p.data into v_data
  from public.projects p
  where p.id = p_project_id
  for update;

  if not found then
    raise exception 'Project not found';
  end if;

  v_job_info := coalesce(v_data->'job_info', '{}'::jsonb) || jsonb_build_object('start_date', clean_date);

  update public.projects
  set
    data = jsonb_set(coalesce(data, '{}'::jsonb), '{job_info}', v_job_info, true),
    updated_at = now(),
    updated_by = uid
  where id = p_project_id;

  perform public.sync_project_start_date_to_manpower(p_project_id);

  return clean_date;
end;
$$;

revoke all on function public.set_project_job_start_date(uuid, text) from public;
grant execute on function public.set_project_job_start_date(uuid, text) to authenticated;

create or replace function manpower_api.set_project_start_date(
  p_token uuid,
  p_project_id uuid,
  p_start_date text
)
returns text
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  v_super public.manpower_supers;
  clean_date text := trim(coalesce(p_start_date, ''));
  v_data jsonb;
  v_job_info jsonb;
begin
  v_super := manpower_api.require_super(p_token);

  select p.data into v_data
  from public.projects p
  where p.id = p_project_id
  for update;

  if not found then
    raise exception 'Project not found';
  end if;

  v_job_info := coalesce(v_data->'job_info', '{}'::jsonb) || jsonb_build_object('start_date', clean_date);

  update public.projects
  set
    data = jsonb_set(coalesce(data, '{}'::jsonb), '{job_info}', v_job_info, true),
    updated_at = now()
  where id = p_project_id;

  update public.manpower_hours_jobs
  set start_date = clean_date, updated_at = now()
  where project_id = p_project_id;

  insert into public.project_activity (project_id, user_id, user_name, action, summary)
  values (
    p_project_id,
    null,
    coalesce(nullif(trim(v_super.name), ''), 'Manpower Cal'),
    'field_start_date_updated',
    case
      when clean_date <> '' then 'Start date set to ' || clean_date || ' (Manpower Cal)'
      else 'Start date cleared (Manpower Cal)'
    end
  );

  return clean_date;
end;
$$;

create or replace function public.manpower_set_project_start_date(
  p_token uuid,
  p_project_id uuid,
  p_start_date text
)
returns text
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.set_project_start_date(p_token, p_project_id, p_start_date); $$;

grant execute on function public.manpower_set_project_start_date(uuid, uuid, text) to anon, authenticated;

create or replace function public.register_project_trade_jobs(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  proj record;
  v_name text;
  v_start_date text;
  rows jsonb := '[]'::jsonb;
  uid uuid := auth.uid();
begin
  if uid is null or not public.is_approved_user(uid) then
    raise exception 'Not authorized';
  end if;

  if public.project_hidden_from_field_apps(p_project_id) then
    return jsonb_build_array(
      jsonb_build_object(
        'job_name', '',
        'ok', true,
        'message', 'Project is hidden from Field Tools and Manpower Cal.'
      )
    );
  end if;

  select p.id, p.job_number, p.job_name, p.data
  into proj
  from public.projects p
  where p.id = p_project_id;

  if not found then
    raise exception 'Project not found';
  end if;

  v_start_date := public.jobflow_project_start_date(proj.data);

  for v_name in
    select distinct n
    from public.jobflow_project_trade_manpower_names(proj.job_number, proj.job_name, proj.data) n
    where trim(n) <> ''
  loop
    insert into public.manpower_hours_jobs (job_name, project_id, budgeted_hours, start_date, updated_at)
    values (v_name, p_project_id, 0, v_start_date, now())
    on conflict (job_name) do update set
      project_id = excluded.project_id,
      start_date = excluded.start_date,
      updated_at = now();

    rows := rows || jsonb_build_array(
      jsonb_build_object(
        'job_name', v_name,
        'ok', true,
        'message', 'Registered in Manpower hours tracker.'
      )
    );
  end loop;

  if jsonb_array_length(rows) = 0 then
    raise exception 'Project must have a job number or name';
  end if;

  perform public.sync_project_start_date_to_manpower(p_project_id);

  return rows;
end;
$$;

create or replace function public.push_budget_hours_to_manpower(
  p_project_id uuid,
  p_budgeted_hours numeric,
  p_include_supervision boolean default false,
  p_contract text default 'paint'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  proj record;
  v_job_name text;
  v_contract text;
  v_start_date text;
  budget_blob jsonb;
  pushes jsonb;
  prior_push jsonb;
  pushed_at timestamptz;
  uid uuid := auth.uid();
begin
  if uid is null or not public.is_approved_user(uid) then
    raise exception 'Not authorized';
  end if;

  if p_budgeted_hours is null or p_budgeted_hours <= 0 then
    raise exception 'Budget hours must be greater than zero';
  end if;

  v_contract := coalesce(nullif(lower(trim(p_contract)), ''), 'paint');
  if v_contract not in ('paint', 'wallcovering', 'frp', 'track') then
    raise exception 'Invalid contract: %', p_contract;
  end if;

  select p.id, p.job_number, p.job_name, p.data
  into proj
  from public.projects p
  where p.id = p_project_id
  for update;

  if not found then
    raise exception 'Project not found';
  end if;

  v_job_name := public.jobflow_manpower_name_for_contract(
    proj.job_number,
    proj.job_name,
    proj.data,
    v_contract
  );
  if v_job_name = '' then
    raise exception 'Project must have a job number or name for the % contract', v_contract;
  end if;

  v_start_date := public.jobflow_project_start_date(proj.data);

  budget_blob := coalesce(proj.data->'budget_maker', '{}'::jsonb);
  pushes := coalesce(budget_blob->'manpower_budget_pushes', '{}'::jsonb);
  prior_push := pushes->v_contract;

  if nullif(prior_push->>'pushed_at', '') is not null then
    raise exception 'Budget hours for the % contract were already pushed to Manpower on %',
      v_contract,
      prior_push->>'pushed_at';
  end if;

  if v_contract = 'paint'
    and nullif(budget_blob->>'manpower_budget_pushed_at', '') is not null
    and pushes = '{}'::jsonb
  then
    raise exception 'Budget hours were already pushed to Manpower on %',
      budget_blob->>'manpower_budget_pushed_at';
  end if;

  insert into public.manpower_hours_jobs (job_name, project_id, budgeted_hours, start_date, updated_at)
  values (v_job_name, p_project_id, p_budgeted_hours, v_start_date, now())
  on conflict (job_name) do update set
    project_id = excluded.project_id,
    budgeted_hours = excluded.budgeted_hours,
    start_date = excluded.start_date,
    updated_at = now();

  perform public.sync_project_start_date_to_manpower(p_project_id);

  pushed_at := now();

  pushes := pushes || jsonb_build_object(
    v_contract,
    jsonb_build_object(
      'pushed_at', pushed_at,
      'hours', p_budgeted_hours,
      'include_supervision', coalesce(p_include_supervision, false),
      'manpower_job_name', v_job_name,
      'pushed_by', uid::text
    )
  );

  budget_blob := budget_blob || jsonb_build_object('manpower_budget_pushes', pushes);

  if v_contract = 'paint' then
    budget_blob := budget_blob || jsonb_build_object(
      'manpower_budget_pushed_at', pushed_at,
      'manpower_budget_hours', p_budgeted_hours,
      'manpower_budget_pushed_by', uid::text,
      'manpower_budget_include_supervision', coalesce(p_include_supervision, false)
    );
  end if;

  update public.projects
  set
    data = jsonb_set(
      coalesce(data, '{}'::jsonb),
      '{budget_maker}',
      budget_blob,
      true
    ),
    updated_at = pushed_at,
    updated_by = uid
  where id = p_project_id;

  return jsonb_build_object(
    'job_name', v_job_name,
    'budgeted_hours', p_budgeted_hours,
    'pushed_at', pushed_at,
    'include_supervision', coalesce(p_include_supervision, false),
    'contract', v_contract
  );
end;
$$;

create or replace function manpower_api.get_state(p_token uuid, p_week_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  wid uuid;
  assign_map jsonb := '{}'::jsonb;
  rec record;
begin
  perform manpower_api.require_super(p_token);
  wid := coalesce(p_week_id, manpower_api.ensure_current_week(p_token));
  perform manpower_api.sync_jobflow_projects(p_token, wid);
  for rec in
    select employee_id, jsonb_object_agg(day_key, cell_value) as days
    from public.manpower_assignments
    where week_id = wid
    group by employee_id
  loop
    assign_map := assign_map || jsonb_build_object(rec.employee_id::text, rec.days);
  end loop;
  return jsonb_build_object(
    'week', (
      select jsonb_build_object('id', w.id, 'week_label', w.week_label, 'week_start', w.week_start)
      from public.manpower_weeks w
      where w.id = wid
    ),
    'weeks', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object('id', w.id, 'week_label', w.week_label, 'week_start', w.week_start)
          order by w.week_start desc
        ),
        '[]'::jsonb
      )
      from public.manpower_weeks w
    ),
    'employees', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object('id', e.id, 'name', e.name, 'role', e.role, 'sort_order', e.sort_order)
          order by e.sort_order, e.name
        ),
        '[]'::jsonb
      )
      from public.manpower_employees e
      where e.active
    ),
    'jobs', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', j.id,
            'name', j.name,
            'project_id', j.project_id,
            'supervisor_label', j.supervisor_label,
            'row_color', j.row_color,
            'sort_order', j.sort_order
          )
          order by j.sort_order, j.name
        ),
        '[]'::jsonb
      )
      from public.manpower_jobs j
      where j.week_id = wid
        and manpower_api.job_is_visible(j.project_id, j.name)
    ),
    'assignments', assign_map,
    'transfer_options', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object('id', t.id, 'am_job', t.am_job, 'pm_job', t.pm_job, 'active', t.active)
        ),
        '[]'::jsonb
      )
      from public.manpower_transfer_options t
      where t.active
    ),
    'hours_tracker', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', h.id,
            'job_name', h.job_name,
            'project_id', h.project_id,
            'budgeted_hours', h.budgeted_hours,
            'week_hours', h.week_hours,
            'start_date', h.start_date
          )
          order by h.job_name
        ),
        '[]'::jsonb
      )
      from public.manpower_hours_jobs h
      where h.project_id is null
        or not public.project_hidden_from_field_apps(h.project_id)
    ),
    'project_options', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'job_number', p.job_number,
            'job_name', p.job_name,
            'label', trim(p.job_number || ' ' || p.job_name)
          )
          order by p.job_number
        ),
        '[]'::jsonb
      )
      from public.projects p
      where not exists (
        select 1
        from public.manpower_project_status s
        where s.project_id = p.id and s.is_done
      )
        and not public.project_hidden_from_field_apps(p.id)
    ),
    'assignment_statuses', manpower_api.assignment_statuses_json(),
    'role_settings', manpower_api.role_settings_json()
  );
end;
$$;

update public.manpower_hours_jobs h
set start_date = public.jobflow_project_start_date(p.data)
from public.projects p
where h.project_id = p.id
  and coalesce(h.start_date, '') = '';

notify pgrst, 'reload schema';
