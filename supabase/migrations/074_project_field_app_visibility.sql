-- Per-project visibility toggle: hide from Field Tools ordering and Manpower Cal.

create table if not exists public.project_field_app_visibility (
  project_id uuid primary key references public.projects(id) on delete cascade,
  hidden_from_field_apps boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.project_field_app_visibility enable row level security;

create or replace function public.project_hidden_from_field_apps(p_project_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(
    (
      select v.hidden_from_field_apps
      from public.project_field_app_visibility v
      where v.project_id = p_project_id
    ),
    false
  );
$$;

-- Distinct Field Tools job numbers for a project (paint + trade contracts).
create or replace function public.project_field_tools_job_numbers(
  p_job_number text,
  p_data jsonb
)
returns setof text
language plpgsql
stable
set search_path = public
as $$
declare
  ji jsonb := coalesce(p_data->'job_info', '{}'::jsonb);
  primary_number text := trim(coalesce(p_job_number, ''));
  trade_number text;
  seen text[] := array[]::text[];
begin
  if primary_number <> '' then
    seen := array_append(seen, lower(primary_number));
    return next primary_number;
  end if;

  if coalesce(ji->>'has_wallcovering', 'false')::boolean then
    trade_number := trim(coalesce(nullif(trim(ji->>'wc_job_number'), ''), primary_number));
    if trade_number <> '' and not (lower(trade_number) = any(seen)) then
      seen := array_append(seen, lower(trade_number));
      return next trade_number;
    end if;
  end if;

  if coalesce(ji->>'has_frp', 'false')::boolean then
    trade_number := trim(coalesce(nullif(trim(ji->>'frp_job_number'), ''), primary_number));
    if trade_number <> '' and not (lower(trade_number) = any(seen)) then
      seen := array_append(seen, lower(trade_number));
      return next trade_number;
    end if;
  end if;

  if coalesce(ji->>'has_track', 'false')::boolean then
    trade_number := trim(coalesce(nullif(trim(ji->>'track_job_number'), ''), primary_number));
    if trade_number <> '' and not (lower(trade_number) = any(seen)) then
      return next trade_number;
    end if;
  end if;

  return;
end;
$$;

create or replace function public.get_project_field_app_visibility(p_project_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.is_approved_user(uid) then
    raise exception 'Not authorized';
  end if;

  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'Project not found';
  end if;

  return public.project_hidden_from_field_apps(p_project_id);
end;
$$;

revoke all on function public.get_project_field_app_visibility(uuid) from public;
grant execute on function public.get_project_field_app_visibility(uuid) to authenticated;

create or replace function public.set_project_field_app_visibility(
  p_project_id uuid,
  p_hidden boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  proj record;
  job_num text;
  next_status text;
begin
  if uid is null or not public.is_approved_user(uid) then
    raise exception 'Not authorized';
  end if;

  select p.id, p.job_number, p.data
  into proj
  from public.projects p
  where p.id = p_project_id;

  if not found then
    raise exception 'Project not found';
  end if;

  insert into public.project_field_app_visibility (project_id, hidden_from_field_apps, updated_at)
  values (p_project_id, p_hidden, now())
  on conflict (project_id) do update
    set hidden_from_field_apps = excluded.hidden_from_field_apps,
        updated_at = now();

  next_status := case when p_hidden then 'hidden' else 'active' end;

  for job_num in
    select distinct n
    from public.project_field_tools_job_numbers(proj.job_number, proj.data) n
    where trim(n) <> ''
  loop
    update public.field_tools_jobs
    set status = next_status, updated_at = now()
    where lower(trim(job_number)) = lower(trim(job_num));
  end loop;

  if p_hidden then
    delete from public.manpower_jobs where project_id = p_project_id;
  end if;

  return p_hidden;
end;
$$;

revoke all on function public.set_project_field_app_visibility(uuid, boolean) from public;
grant execute on function public.set_project_field_app_visibility(uuid, boolean) to authenticated;

create or replace function manpower_api.job_is_visible(p_project_id uuid, p_job_name text)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    case
      when p_project_id is not null then
        not exists (
          select 1
          from public.manpower_project_status s
          where s.project_id = p_project_id and s.is_done
        )
        and not public.project_hidden_from_field_apps(p_project_id)
      else
        not exists (
          select 1
          from public.manpower_hidden_manual_jobs h
          where h.job_name_lower = lower(trim(coalesce(p_job_name, '')))
        )
    end;
$$;

create or replace function manpower_api.sync_jobflow_projects(p_token uuid, p_week_id uuid)
returns int
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  added int := 0;
  rec record;
  v_name text;
begin
  perform manpower_api.require_super(p_token);
  for rec in
    select p.id, p.job_number, p.job_name, p.data
    from public.projects p
    where not exists (
      select 1
      from public.manpower_project_status s
      where s.project_id = p.id and s.is_done
    )
      and not public.project_hidden_from_field_apps(p.id)
    order by p.job_number
  loop
    for v_name in
      select distinct n
      from public.jobflow_project_trade_manpower_names(rec.job_number, rec.job_name, rec.data) n
      where trim(n) <> ''
    loop
      if not exists (
        select 1
        from public.manpower_jobs j
        where j.week_id = p_week_id and lower(j.name) = lower(v_name)
      ) then
        perform manpower_api.add_job(p_token, p_week_id, v_name, null, rec.id);
        added := added + 1;
      end if;
    end loop;
  end loop;
  return added;
end;
$$;

create or replace function public.register_project_trade_jobs(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  proj record;
  v_name text;
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

  for v_name in
    select distinct n
    from public.jobflow_project_trade_manpower_names(proj.job_number, proj.job_name, proj.data) n
    where trim(n) <> ''
  loop
    insert into public.manpower_hours_jobs (job_name, project_id, budgeted_hours, updated_at)
    values (v_name, p_project_id, 0, now())
    on conflict (job_name) do update set
      project_id = excluded.project_id,
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

  return rows;
end;
$$;

create or replace function public.upsert_field_tools_job(
  p_job_number text,
  p_job_name text,
  p_address text,
  p_superintendent text,
  p_project_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  clean_number text := trim(p_job_number);
  next_status text := 'active';
begin
  if uid is null or not public.is_approved_user(uid) then
    raise exception 'Not authorized';
  end if;
  if clean_number = '' then
    raise exception 'Job number is required';
  end if;

  if p_project_id is not null and public.project_hidden_from_field_apps(p_project_id) then
    next_status := 'hidden';
  end if;

  update public.field_tools_jobs
  set
    job_name = coalesce(nullif(trim(p_job_name), ''), job_name),
    address = coalesce(nullif(trim(p_address), ''), address),
    superintendent = coalesce(nullif(trim(p_superintendent), ''), superintendent),
    status = next_status,
    updated_at = now()
  where lower(trim(job_number)) = lower(clean_number);

  if found then
    return;
  end if;

  insert into public.field_tools_jobs (job_number, job_name, address, superintendent, status, updated_at)
  values (
    clean_number,
    coalesce(nullif(trim(p_job_name), ''), ''),
    coalesce(nullif(trim(p_address), ''), ''),
    coalesce(nullif(trim(p_superintendent), ''), ''),
    next_status,
    now()
  );
end;
$$;

revoke all on function public.upsert_field_tools_job(text, text, text, text, uuid) from public;
grant execute on function public.upsert_field_tools_job(text, text, text, text, uuid) to authenticated;

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
            'week_hours', h.week_hours
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

create or replace function public.field_tools_list_jobs(
  p_caller_id uuid,
  p_session_token text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.field_tools_require_session(p_caller_id, p_session_token);

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', j.id,
          'job_number', j.job_number,
          'job_name', j.job_name,
          'address', j.address,
          'superintendent', j.superintendent
        )
        order by j.job_number
      ),
      '[]'::jsonb
    )
    from public.field_tools_jobs j
    where j.status = 'active'
  );
end;
$$;

revoke all on function public.field_tools_list_jobs(uuid, text) from public;
grant execute on function public.field_tools_list_jobs(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
