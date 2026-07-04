-- Admin-managed assignment statuses (OFF, Sick, Holiday, DDO, etc.)

create table if not exists public.manpower_assignment_statuses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order int not null default 0,
  is_builtin boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists manpower_assignment_statuses_name_lower_idx
  on public.manpower_assignment_statuses (lower(trim(name)));

insert into public.manpower_assignment_statuses (name, sort_order, is_builtin, active)
values
  ('OFF', 0, true, true),
  ('No Call No Show', 1, true, true),
  ('Sick', 2, true, true),
  ('Vacation', 3, true, true),
  ('Training', 4, true, true),
  ('School', 5, true, true)
on conflict ((lower(trim(name)))) do nothing;

alter table public.manpower_assignment_statuses enable row level security;

create or replace function manpower_api.assignment_statuses_json()
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'sort_order', s.sort_order,
        'is_builtin', s.is_builtin,
        'active', s.active
      )
      order by s.sort_order, s.name
    ),
    '[]'::jsonb
  )
  from public.manpower_assignment_statuses s
  where s.active;
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
    ),
    'assignment_statuses', manpower_api.assignment_statuses_json(),
    'role_settings', manpower_api.role_settings_json()
  );
end;
$$;

create or replace function manpower_api.admin_list_assignment_statuses(p_token uuid)
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
          'id', s.id,
          'name', s.name,
          'sort_order', s.sort_order,
          'is_builtin', s.is_builtin,
          'active', s.active
        )
        order by s.sort_order, s.name
      ),
      '[]'::jsonb
    )
    from public.manpower_assignment_statuses s
  );
end;
$$;

create or replace function manpower_api.admin_upsert_assignment_status(
  p_token uuid,
  p_name text,
  p_status_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  clean_name text := trim(coalesce(p_name, ''));
  sid uuid;
  next_order int;
begin
  perform manpower_api.require_admin(p_token);

  if clean_name = '' then
    raise exception 'INVALID_STATUS_NAME' using errcode = 'P0001';
  end if;

  if lower(clean_name) = 'none' then
    raise exception 'RESERVED_STATUS_NAME' using errcode = 'P0001';
  end if;

  if p_status_id is not null then
    update public.manpower_assignment_statuses
    set name = clean_name, updated_at = now()
    where id = p_status_id and not is_builtin
    returning id into sid;

    if sid is null then
      raise exception 'CANNOT_EDIT_BUILTIN_STATUS' using errcode = 'P0001';
    end if;

    return sid;
  end if;

  if exists (
    select 1
    from public.manpower_assignment_statuses s
    where lower(trim(s.name)) = lower(clean_name)
  ) then
    raise exception 'DUPLICATE_STATUS_NAME' using errcode = 'P0001';
  end if;

  select coalesce(max(sort_order), 0) + 1
  into next_order
  from public.manpower_assignment_statuses;

  insert into public.manpower_assignment_statuses (name, sort_order, is_builtin, active)
  values (clean_name, next_order, false, true)
  returning id into sid;

  return sid;
end;
$$;

create or replace function manpower_api.admin_set_assignment_status_active(
  p_token uuid,
  p_status_id uuid,
  p_active boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, manpower_api
as $$
begin
  perform manpower_api.require_admin(p_token);

  if not p_active then
    update public.manpower_assignment_statuses
    set active = false, updated_at = now()
    where id = p_status_id and not is_builtin;

    if not found then
      raise exception 'CANNOT_REMOVE_BUILTIN_STATUS' using errcode = 'P0001';
    end if;

    return true;
  end if;

  update public.manpower_assignment_statuses
  set active = true, updated_at = now()
  where id = p_status_id;

  if not found then
    raise exception 'STATUS_NOT_FOUND' using errcode = 'P0001';
  end if;

  return true;
end;
$$;

create or replace function public.manpower_admin_list_assignment_statuses(p_token uuid)
returns jsonb
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.admin_list_assignment_statuses(p_token); $$;

create or replace function public.manpower_admin_upsert_assignment_status(
  p_token uuid,
  p_name text,
  p_status_id uuid default null
)
returns uuid
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.admin_upsert_assignment_status(p_token, p_name, p_status_id); $$;

create or replace function public.manpower_admin_set_assignment_status_active(
  p_token uuid,
  p_status_id uuid,
  p_active boolean
)
returns boolean
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.admin_set_assignment_status_active(p_token, p_status_id, p_active); $$;

notify pgrst, 'reload schema';
