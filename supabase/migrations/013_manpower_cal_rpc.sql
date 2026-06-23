-- Manpower Cal RPC functions (run after 013_manpower_cal.sql)

create or replace function manpower_api.require_super(p_token uuid)
returns public.manpower_supers
language plpgsql security definer set search_path = public, manpower_api
as $$
declare s public.manpower_supers;
begin
  delete from public.manpower_sessions where expires_at <= now();
  select ms.* into s from public.manpower_sessions sess
  join public.manpower_supers ms on ms.id = sess.super_id
  where sess.token = p_token and sess.expires_at > now() and ms.active;
  if not found then raise exception 'INVALID_SESSION' using errcode = 'P0001'; end if;
  return s;
end;
$$;

create or replace function manpower_api.require_admin(p_token uuid)
returns public.manpower_supers
language plpgsql security definer set search_path = public, manpower_api
as $$
declare s public.manpower_supers;
begin
  s := manpower_api.require_super(p_token);
  if not s.is_admin then raise exception 'ADMIN_REQUIRED' using errcode = 'P0001'; end if;
  return s;
end;
$$;

create or replace function manpower_api.login(p_pin text)
returns jsonb
language plpgsql security definer set search_path = public, manpower_api
as $$
declare s public.manpower_supers; tok uuid; exp timestamptz;
begin
  if p_pin is null or length(trim(p_pin)) < 4 then
    raise exception 'INVALID_PIN' using errcode = 'P0001';
  end if;
  select * into s from public.manpower_supers
  where active and pin_hash = crypt(trim(p_pin), pin_hash)
  order by is_admin desc limit 1;
  if not found then raise exception 'INVALID_PIN' using errcode = 'P0001'; end if;
  exp := now() + interval '12 hours';
  insert into public.manpower_sessions (super_id, expires_at) values (s.id, exp) returning token into tok;
  return jsonb_build_object(
    'token', tok, 'expires_at', exp,
    'super', jsonb_build_object('id', s.id, 'name', s.name, 'is_admin', s.is_admin, 'supervisor_label', s.supervisor_label)
  );
end;
$$;

create or replace function manpower_api.logout(p_token uuid)
returns boolean language plpgsql security definer set search_path = public, manpower_api
as $$ begin delete from public.manpower_sessions where token = p_token; return true; end; $$;

create or replace function manpower_api.session_info(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public, manpower_api
as $$
declare s public.manpower_supers;
begin
  s := manpower_api.require_super(p_token);
  return jsonb_build_object('id', s.id, 'name', s.name, 'is_admin', s.is_admin, 'supervisor_label', s.supervisor_label);
end;
$$;

create or replace function manpower_api.ensure_current_week(p_token uuid)
returns uuid language plpgsql security definer set search_path = public, manpower_api
as $$
declare wid uuid; mon date; lbl text; prev_week uuid;
begin
  perform manpower_api.require_super(p_token);
  mon := current_date - ((extract(isodow from current_date)::int + 6) % 7);
  lbl := extract(month from mon)::int::text || '/' || extract(day from mon)::int::text;
  select id into wid from public.manpower_weeks where week_label = lbl;
  if wid is not null then return wid; end if;
  insert into public.manpower_weeks (week_label, week_start) values (lbl, mon) returning id into wid;
  select id into prev_week from public.manpower_weeks where id <> wid order by week_start desc limit 1;
  if prev_week is not null then
    insert into public.manpower_jobs (week_id, name, project_id, supervisor_label, row_color, sort_order)
    select wid, name, project_id, supervisor_label, row_color, sort_order
    from public.manpower_jobs where week_id = prev_week;
  end if;
  return wid;
end;
$$;

create or replace function manpower_api.get_state(p_token uuid, p_week_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, manpower_api
as $$
declare wid uuid; assign_map jsonb := '{}'::jsonb; rec record;
begin
  perform manpower_api.require_super(p_token);
  wid := coalesce(p_week_id, manpower_api.ensure_current_week(p_token));
  for rec in
    select employee_id, jsonb_object_agg(day_key, cell_value) as days
    from public.manpower_assignments where week_id = wid group by employee_id
  loop
    assign_map := assign_map || jsonb_build_object(rec.employee_id::text, rec.days);
  end loop;
  return jsonb_build_object(
    'week', (select jsonb_build_object('id', w.id, 'week_label', w.week_label, 'week_start', w.week_start)
      from public.manpower_weeks w where w.id = wid),
    'weeks', (select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'week_label', w.week_label, 'week_start', w.week_start)
      order by w.week_start desc), '[]'::jsonb) from public.manpower_weeks w),
    'employees', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'role', e.role, 'sort_order', e.sort_order)
      order by e.sort_order, e.name), '[]'::jsonb) from public.manpower_employees e where e.active),
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'name', j.name, 'project_id', j.project_id,
      'supervisor_label', j.supervisor_label, 'row_color', j.row_color, 'sort_order', j.sort_order)
      order by j.sort_order, j.name), '[]'::jsonb) from public.manpower_jobs j where j.week_id = wid),
    'assignments', assign_map,
    'transfer_options', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'am_job', t.am_job, 'pm_job', t.pm_job, 'active', t.active)), '[]'::jsonb)
      from public.manpower_transfer_options t where t.active),
    'hours_tracker', (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'job_name', h.job_name, 'project_id', h.project_id,
      'budgeted_hours', h.budgeted_hours, 'week_hours', h.week_hours) order by h.job_name), '[]'::jsonb)
      from public.manpower_hours_jobs h),
    'project_options', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'job_number', p.job_number, 'job_name', p.job_name,
      'label', trim(p.job_number || ' ' || p.job_name)) order by p.job_number), '[]'::jsonb) from public.projects p)
  );
end;
$$;

create or replace function manpower_api.set_assignment(p_token uuid, p_week_id uuid, p_employee_id uuid, p_day_key text, p_value text)
returns boolean language plpgsql security definer set search_path = public, manpower_api
as $$
begin
  perform manpower_api.require_super(p_token);
  insert into public.manpower_assignments (week_id, employee_id, day_key, cell_value, updated_at)
  values (p_week_id, p_employee_id, p_day_key, coalesce(p_value, ''), now())
  on conflict (week_id, employee_id, day_key) do update set cell_value = excluded.cell_value, updated_at = now();
  return true;
end;
$$;

create or replace function manpower_api.add_job(p_token uuid, p_week_id uuid, p_name text, p_supervisor_label text default null, p_project_id uuid default null, p_row_color text default '#ffffff')
returns uuid language plpgsql security definer set search_path = public, manpower_api
as $$
declare jid uuid; color text := coalesce(p_row_color, '#ffffff');
begin
  perform manpower_api.require_super(p_token);
  if p_supervisor_label = 'Robert' then color := '#ffff00';
  elsif p_supervisor_label = 'John' then color := '#ff9900'; end if;
  insert into public.manpower_jobs (week_id, name, project_id, supervisor_label, row_color, sort_order)
  values (p_week_id, trim(p_name), p_project_id, p_supervisor_label, color,
    (select coalesce(max(sort_order), 0) + 1 from public.manpower_jobs where week_id = p_week_id))
  returning id into jid;
  return jid;
end;
$$;

create or replace function manpower_api.import_projects(p_token uuid, p_week_id uuid)
returns int language plpgsql security definer set search_path = public, manpower_api
as $$
declare added int := 0; rec record;
begin
  perform manpower_api.require_super(p_token);
  for rec in select p.id, trim(p.job_number || ' ' || p.job_name) as name from public.projects p order by p.job_number loop
    if not exists (select 1 from public.manpower_jobs j where j.week_id = p_week_id and lower(j.name) = lower(rec.name)) then
      perform manpower_api.add_job(p_token, p_week_id, rec.name, null, rec.id);
      added := added + 1;
    end if;
  end loop;
  return added;
end;
$$;

create or replace function manpower_api.set_hours_budget(p_token uuid, p_job_name text, p_budgeted_hours numeric)
returns boolean language plpgsql security definer set search_path = public, manpower_api
as $$
begin
  perform manpower_api.require_super(p_token);
  insert into public.manpower_hours_jobs (job_name, budgeted_hours, updated_at)
  values (trim(p_job_name), coalesce(p_budgeted_hours, 0), now())
  on conflict (job_name) do update set budgeted_hours = excluded.budgeted_hours, updated_at = now();
  return true;
end;
$$;

create or replace function manpower_api.log_week_hours(p_token uuid, p_job_name text, p_week_label text, p_hours numeric)
returns boolean language plpgsql security definer set search_path = public, manpower_api
as $$
begin
  perform manpower_api.require_super(p_token);
  insert into public.manpower_hours_jobs (job_name, week_hours, updated_at)
  values (trim(p_job_name), jsonb_build_object(p_week_label, p_hours), now())
  on conflict (job_name) do update set
    week_hours = public.manpower_hours_jobs.week_hours || jsonb_build_object(p_week_label, p_hours),
    updated_at = now();
  return true;
end;
$$;

create or replace function manpower_api.admin_list_supers(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public, manpower_api
as $$
begin perform manpower_api.require_admin(p_token);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'supervisor_label', s.supervisor_label, 'is_admin', s.is_admin, 'active', s.active) order by s.name), '[]'::jsonb)
    from public.manpower_supers s);
end; $$;

create or replace function manpower_api.admin_upsert_super(p_token uuid, p_name text, p_pin text, p_supervisor_label text default null, p_is_admin boolean default false, p_super_id uuid default null)
returns uuid language plpgsql security definer set search_path = public, manpower_api
as $$
declare sid uuid;
begin
  perform manpower_api.require_admin(p_token);
  if p_super_id is null then
    insert into public.manpower_supers (name, pin_hash, supervisor_label, is_admin)
    values (trim(p_name), crypt(trim(p_pin), gen_salt('bf')), p_supervisor_label, coalesce(p_is_admin, false)) returning id into sid;
  else
    update public.manpower_supers set name = trim(p_name), supervisor_label = p_supervisor_label,
      is_admin = coalesce(p_is_admin, is_admin),
      pin_hash = case when p_pin is not null and length(trim(p_pin)) >= 4 then crypt(trim(p_pin), gen_salt('bf')) else pin_hash end,
      updated_at = now() where id = p_super_id returning id into sid;
  end if;
  return sid;
end; $$;

create or replace function manpower_api.admin_set_super_active(p_token uuid, p_super_id uuid, p_active boolean)
returns boolean language plpgsql security definer set search_path = public, manpower_api
as $$ begin perform manpower_api.require_admin(p_token);
  update public.manpower_supers set active = p_active, updated_at = now() where id = p_super_id; return true; end; $$;

create or replace function manpower_api.admin_list_employees(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public, manpower_api
as $$
begin perform manpower_api.require_admin(p_token);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'role', e.role, 'sort_order', e.sort_order, 'active', e.active) order by e.sort_order, e.name), '[]'::jsonb)
    from public.manpower_employees e);
end; $$;

create or replace function manpower_api.admin_upsert_employee(p_token uuid, p_name text, p_role text default 'normal', p_sort_order int default 0, p_employee_id uuid default null)
returns uuid language plpgsql security definer set search_path = public, manpower_api
as $$
declare eid uuid;
begin
  perform manpower_api.require_admin(p_token);
  if p_employee_id is null then
    insert into public.manpower_employees (name, role, sort_order) values (trim(p_name), coalesce(p_role, 'normal'), coalesce(p_sort_order, 0)) returning id into eid;
  else
    update public.manpower_employees set name = trim(p_name), role = coalesce(p_role, role), sort_order = coalesce(p_sort_order, sort_order)
    where id = p_employee_id returning id into eid;
  end if;
  return eid;
end; $$;

create or replace function manpower_api.admin_set_employee_active(p_token uuid, p_employee_id uuid, p_active boolean)
returns boolean language plpgsql security definer set search_path = public, manpower_api
as $$ begin perform manpower_api.require_admin(p_token);
  update public.manpower_employees set active = p_active where id = p_employee_id; return true; end; $$;

grant execute on all functions in schema manpower_api to anon, authenticated;

insert into public.manpower_supers (name, pin_hash, is_admin, supervisor_label)
select 'Office Admin', crypt('0000', gen_salt('bf')), true, null
where not exists (select 1 from public.manpower_supers where is_admin);

insert into public.manpower_supers (name, pin_hash, is_admin, supervisor_label)
select 'Robert', crypt('1111', gen_salt('bf')), false, 'Robert'
where not exists (select 1 from public.manpower_supers where name = 'Robert');

insert into public.manpower_supers (name, pin_hash, is_admin, supervisor_label)
select 'John', crypt('2222', gen_salt('bf')), false, 'John'
where not exists (select 1 from public.manpower_supers where name = 'John');

insert into public.manpower_employees (name, role, sort_order)
select v.name, v.role, v.ord from (values
  ('Roberto Vallejo', 'foreman', 1), ('Daniel Espinoza', 'leadman', 2),
  ('Carlos Garcia', 'apprentice', 3), ('Gabriel', 'wallcovering', 4)
) as v(name, role, ord) where not exists (select 1 from public.manpower_employees limit 1);
