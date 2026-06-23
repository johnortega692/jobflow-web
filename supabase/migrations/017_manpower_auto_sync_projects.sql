-- Auto-sync JobFlow projects into the active week on every schedule load.

create or replace function manpower_api.sync_jobflow_projects(p_token uuid, p_week_id uuid)
returns int
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  added int := 0;
  rec record;
begin
  perform manpower_api.require_super(p_token);
  for rec in
    select p.id, trim(p.job_number || ' ' || p.job_name) as name
    from public.projects p
    where trim(coalesce(p.job_number, '') || ' ' || coalesce(p.job_name, '')) <> ''
    order by p.job_number
  loop
    if not exists (
      select 1
      from public.manpower_jobs j
      where j.week_id = p_week_id and lower(j.name) = lower(rec.name)
    ) then
      perform manpower_api.add_job(p_token, p_week_id, rec.name, null, rec.id);
      added := added + 1;
    end if;
  end loop;
  return added;
end;
$$;

create or replace function manpower_api.import_projects(p_token uuid, p_week_id uuid)
returns int
language plpgsql
security definer
set search_path = public, manpower_api
as $$
begin
  return manpower_api.sync_jobflow_projects(p_token, p_week_id);
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
    )
  );
end;
$$;

create or replace function manpower_api.create_next_week(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  wid uuid;
  mon date;
  lbl text;
  prev_week uuid;
  latest date;
begin
  perform manpower_api.require_super(p_token);
  select max(week_start) into latest from public.manpower_weeks;
  if latest is null then
    return manpower_api.ensure_current_week(p_token);
  end if;
  mon := latest + 7;
  lbl := manpower_api.week_label_for_date(mon);
  select id into wid from public.manpower_weeks where week_label = lbl;
  if wid is not null then
    perform manpower_api.sync_jobflow_projects(p_token, wid);
    return wid;
  end if;
  insert into public.manpower_weeks (week_label, week_start) values (lbl, mon) returning id into wid;
  select id into prev_week from public.manpower_weeks where week_start = latest limit 1;
  perform manpower_api.copy_jobs_from_week(wid, prev_week);
  perform manpower_api.sync_jobflow_projects(p_token, wid);
  return wid;
end;
$$;

notify pgrst, 'reload schema';
