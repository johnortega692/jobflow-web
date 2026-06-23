-- Admin: mark JobFlow projects done → hidden from sync and all schedule job lists.

create table if not exists public.manpower_project_status (
  project_id uuid primary key references public.projects(id) on delete cascade,
  is_done boolean not null default true,
  marked_done_at timestamptz,
  marked_active_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.manpower_hidden_manual_jobs (
  job_name_lower text primary key,
  hidden_at timestamptz not null default now()
);

alter table public.manpower_project_status enable row level security;
alter table public.manpower_hidden_manual_jobs enable row level security;

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
begin
  perform manpower_api.require_super(p_token);
  for rec in
    select p.id, trim(p.job_number || ' ' || p.job_name) as name
    from public.projects p
    where trim(coalesce(p.job_number, '') || ' ' || coalesce(p.job_name, '')) <> ''
      and not exists (
        select 1
        from public.manpower_project_status s
        where s.project_id = p.id and s.is_done
      )
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

create or replace function manpower_api.copy_jobs_from_week(p_dest uuid, p_source uuid)
returns void
language plpgsql
security definer
set search_path = public, manpower_api
as $$
begin
  if p_source is null then
    return;
  end if;
  insert into public.manpower_jobs (week_id, name, project_id, supervisor_label, row_color, sort_order)
  select p_dest, j.name, j.project_id, j.supervisor_label, j.row_color, j.sort_order
  from public.manpower_jobs j
  where j.week_id = p_source
    and manpower_api.job_is_visible(j.project_id, j.name);
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
      where not exists (
        select 1
        from public.manpower_project_status s
        where s.project_id = p.id and s.is_done
      )
    )
  );
end;
$$;

create or replace function manpower_api.admin_list_projects(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, manpower_api
as $$
begin
  perform manpower_api.require_admin(p_token);
  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'job_number', p.job_number,
          'job_name', p.job_name,
          'label', trim(p.job_number || ' ' || p.job_name),
          'is_done', coalesce(s.is_done, false)
        )
        order by coalesce(s.is_done, false), p.job_number
      ),
      '[]'::jsonb
    )
    from public.projects p
    left join public.manpower_project_status s on s.project_id = p.id
    where trim(coalesce(p.job_number, '') || ' ' || coalesce(p.job_name, '')) <> ''
  );
end;
$$;

create or replace function manpower_api.admin_set_project_done(
  p_token uuid,
  p_project_id uuid,
  p_done boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, manpower_api
as $$
begin
  perform manpower_api.require_admin(p_token);
  if p_done then
    insert into public.manpower_project_status (project_id, is_done, marked_done_at, updated_at)
    values (p_project_id, true, now(), now())
    on conflict (project_id) do update
      set is_done = true, marked_done_at = now(), updated_at = now();
    delete from public.manpower_jobs where project_id = p_project_id;
  else
    insert into public.manpower_project_status (project_id, is_done, marked_active_at, updated_at)
    values (p_project_id, false, now(), now())
    on conflict (project_id) do update
      set is_done = false, marked_active_at = now(), updated_at = now();
  end if;
  return true;
end;
$$;

create or replace function manpower_api.admin_list_manual_jobs(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, manpower_api
as $$
begin
  perform manpower_api.require_admin(p_token);
  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'name', names.name,
          'is_hidden', exists (
            select 1
            from public.manpower_hidden_manual_jobs h
            where h.job_name_lower = lower(names.name)
          )
        )
        order by names.name
      ),
      '[]'::jsonb
    )
    from (
      select distinct j.name
      from public.manpower_jobs j
      where j.project_id is null
        and trim(j.name) <> ''
    ) names
  );
end;
$$;

create or replace function manpower_api.admin_set_manual_job_hidden(
  p_token uuid,
  p_job_name text,
  p_hidden boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  key text := lower(trim(p_job_name));
begin
  perform manpower_api.require_admin(p_token);
  if key = '' then
    raise exception 'JOB_NAME_REQUIRED' using errcode = 'P0001';
  end if;
  if p_hidden then
    insert into public.manpower_hidden_manual_jobs (job_name_lower, hidden_at)
    values (key, now())
    on conflict (job_name_lower) do update set hidden_at = now();
    delete from public.manpower_jobs j
    where j.project_id is null and lower(trim(j.name)) = key;
  else
    delete from public.manpower_hidden_manual_jobs where job_name_lower = key;
  end if;
  return true;
end;
$$;

create or replace function public.manpower_admin_list_projects(p_token uuid)
returns jsonb
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.admin_list_projects(p_token); $$;

create or replace function public.manpower_admin_set_project_done(
  p_token uuid,
  p_project_id uuid,
  p_done boolean
)
returns boolean
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.admin_set_project_done(p_token, p_project_id, p_done); $$;

create or replace function public.manpower_admin_list_manual_jobs(p_token uuid)
returns jsonb
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.admin_list_manual_jobs(p_token); $$;

create or replace function public.manpower_admin_set_manual_job_hidden(
  p_token uuid,
  p_job_name text,
  p_hidden boolean
)
returns boolean
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.admin_set_manual_job_hidden(p_token, p_job_name, p_hidden); $$;

notify pgrst, 'reload schema';
