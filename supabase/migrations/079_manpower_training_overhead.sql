-- Non-billable training overhead: schedule row + attributed hours (office vs for-project).

alter table public.manpower_hours_jobs
  add column if not exists is_training_overhead boolean not null default false,
  add column if not exists training_log jsonb not null default '{}'::jsonb;

create or replace function manpower_api.training_job_name()
returns text
language sql
immutable
as $$ select 'Training (non-billable)'; $$;

create or replace function manpower_api.ensure_training_hours_row()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.manpower_hours_jobs (job_name, is_training_overhead, budgeted_hours, week_hours, training_log, updated_at)
  values (manpower_api.training_job_name(), true, 0, '{}'::jsonb, '{}'::jsonb, now())
  on conflict (job_name) do update
    set is_training_overhead = true,
        updated_at = now();
end;
$$;

create or replace function manpower_api.ensure_training_job(p_week_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_week_id is null then
    return;
  end if;

  if not exists (
    select 1
    from public.manpower_jobs j
    where j.week_id = p_week_id
      and lower(trim(j.name)) = lower(manpower_api.training_job_name())
  ) then
    insert into public.manpower_jobs (week_id, name, project_id, supervisor_label, row_color, sort_order)
    values (p_week_id, manpower_api.training_job_name(), null, null, '#4a5568', -999);
  end if;
end;
$$;

create or replace function manpower_api.log_training_week_hours(
  p_token uuid,
  p_week_label text,
  p_office_hours numeric,
  p_by_project jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  v_label text := trim(coalesce(p_week_label, ''));
  v_by_project jsonb := coalesce(p_by_project, '{}'::jsonb);
begin
  perform manpower_api.require_super(p_token);
  if v_label = '' then
    raise exception 'Week label is required';
  end if;

  perform manpower_api.ensure_training_hours_row();

  insert into public.manpower_hours_jobs (job_name, is_training_overhead, training_log, updated_at)
  values (
    manpower_api.training_job_name(),
    true,
    jsonb_build_object(
      v_label,
      jsonb_build_object(
        'office', coalesce(p_office_hours, 0),
        'by_project', v_by_project
      )
    ),
    now()
  )
  on conflict (job_name) do update set
    training_log = public.manpower_hours_jobs.training_log
      || jsonb_build_object(
        v_label,
        jsonb_build_object(
          'office', coalesce(p_office_hours, 0),
          'by_project', v_by_project
        )
      ),
    updated_at = now();

  return true;
end;
$$;

create or replace function public.manpower_log_training_week_hours(
  p_token uuid,
  p_week_label text,
  p_office_hours numeric,
  p_by_project jsonb default '{}'::jsonb
)
returns boolean
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.log_training_week_hours(p_token, p_week_label, p_office_hours, p_by_project); $$;

grant execute on function public.manpower_log_training_week_hours(uuid, text, numeric, jsonb) to anon, authenticated;

create or replace function manpower_api.log_week_hours(
  p_token uuid,
  p_job_name text,
  p_week_label text,
  p_hours numeric
)
returns boolean
language plpgsql
security definer
set search_path = public, manpower_api
as $$
begin
  perform manpower_api.require_super(p_token);
  if lower(trim(coalesce(p_job_name, ''))) = lower(manpower_api.training_job_name()) then
    raise exception 'Use manpower_log_training_week_hours for training hours';
  end if;

  insert into public.manpower_hours_jobs (job_name, week_hours, updated_at)
  values (trim(p_job_name), jsonb_build_object(p_week_label, p_hours), now())
  on conflict (job_name) do update set
    week_hours = public.manpower_hours_jobs.week_hours || jsonb_build_object(p_week_label, p_hours),
    updated_at = now();
  return true;
end;
$$;

create or replace function manpower_api.copy_jobs_from_week(p_dest uuid, p_source uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_source is null then
    perform manpower_api.ensure_training_job(p_dest);
    return;
  end if;

  insert into public.manpower_jobs (week_id, name, project_id, supervisor_label, row_color, sort_order)
  select p_dest, name, project_id, supervisor_label, row_color, sort_order
  from public.manpower_jobs
  where week_id = p_source
    and lower(trim(name)) <> lower(manpower_api.training_job_name());

  perform manpower_api.ensure_training_job(p_dest);
end;
$$;

create or replace function manpower_api.ensure_current_week(p_token uuid)
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
begin
  perform manpower_api.require_super(p_token);
  mon := current_date - ((extract(isodow from current_date)::int + 6) % 7);
  lbl := extract(month from mon)::int::text || '/' || extract(day from mon)::int::text;
  select id into wid from public.manpower_weeks where week_label = lbl;
  if wid is not null then
    perform manpower_api.ensure_training_job(wid);
    perform manpower_api.ensure_training_hours_row();
    return wid;
  end if;

  insert into public.manpower_weeks (week_label, week_start) values (lbl, mon) returning id into wid;
  select id into prev_week from public.manpower_weeks where id <> wid order by week_start desc limit 1;
  if prev_week is not null then
    perform manpower_api.copy_jobs_from_week(wid, prev_week);
  else
    perform manpower_api.ensure_training_job(wid);
  end if;
  perform manpower_api.ensure_training_hours_row();
  return wid;
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
    perform manpower_api.ensure_training_job(wid);
    return wid;
  end if;
  insert into public.manpower_weeks (week_label, week_start) values (lbl, mon) returning id into wid;
  select id into prev_week from public.manpower_weeks where week_start = latest limit 1;
  perform manpower_api.copy_jobs_from_week(wid, prev_week);
  return wid;
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
  perform manpower_api.ensure_training_job(wid);
  perform manpower_api.ensure_training_hours_row();
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
            'start_date', h.start_date,
            'is_training_overhead', h.is_training_overhead,
            'training_log', h.training_log
          )
          order by h.is_training_overhead desc, h.job_name
        ),
        '[]'::jsonb
      )
      from public.manpower_hours_jobs h
      where h.is_training_overhead
        or h.project_id is null
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

-- Backfill training row on all existing weeks.
do $$
declare
  w record;
begin
  perform manpower_api.ensure_training_hours_row();
  for w in select id from public.manpower_weeks loop
    perform manpower_api.ensure_training_job(w.id);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
