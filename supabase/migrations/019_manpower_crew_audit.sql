-- Crew assignment audit log (admin view only) + rename role normal → journeyman.

create table if not exists public.manpower_crew_audit_log (
  id uuid primary key default gen_random_uuid(),
  super_id uuid not null references public.manpower_supers(id) on delete cascade,
  super_name text not null,
  week_id uuid not null references public.manpower_weeks(id) on delete cascade,
  week_label text not null,
  employee_id uuid not null references public.manpower_employees(id) on delete cascade,
  employee_name text not null,
  day_key text not null check (day_key in ('mon','tue','wed','thu','fri','sat','sun')),
  old_value text not null default '',
  new_value text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists manpower_crew_audit_log_created_at_idx
  on public.manpower_crew_audit_log (created_at desc);

alter table public.manpower_crew_audit_log enable row level security;

alter table public.manpower_employees drop constraint if exists manpower_employees_role_check;

update public.manpower_employees
set role = 'journeyman'
where role = 'normal';

alter table public.manpower_employees
  add constraint manpower_employees_role_check
  check (role in ('foreman', 'leadman', 'apprentice', 'wallcovering', 'journeyman'));

alter table public.manpower_employees alter column role set default 'journeyman';

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
  end if;

  return true;
end;
$$;

create or replace function manpower_api.admin_upsert_employee(
  p_token uuid,
  p_name text,
  p_role text default 'journeyman',
  p_sort_order int default 0,
  p_employee_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  eid uuid;
  role_val text := case when coalesce(p_role, 'journeyman') = 'normal' then 'journeyman' else coalesce(p_role, 'journeyman') end;
begin
  if p_employee_id is null then
    perform manpower_api.require_super(p_token);
    if p_name is null or length(trim(p_name)) < 1 then
      raise exception 'NAME_REQUIRED' using errcode = 'P0001';
    end if;
    insert into public.manpower_employees (name, role, sort_order)
    values (trim(p_name), role_val, coalesce(p_sort_order, 0))
    returning id into eid;
  else
    perform manpower_api.require_admin(p_token);
    update public.manpower_employees
    set
      name = trim(p_name),
      role = case when coalesce(p_role, role) = 'normal' then 'journeyman' else coalesce(p_role, role) end,
      sort_order = coalesce(p_sort_order, sort_order)
    where id = p_employee_id
    returning id into eid;
  end if;
  return eid;
end;
$$;

create or replace function manpower_api.admin_list_crew_audit(
  p_token uuid,
  p_limit int default 100
)
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
          'id', l.id,
          'super_name', l.super_name,
          'week_label', l.week_label,
          'employee_name', l.employee_name,
          'day_key', l.day_key,
          'old_value', l.old_value,
          'new_value', l.new_value,
          'created_at', l.created_at
        )
        order by l.created_at desc
      ),
      '[]'::jsonb
    )
    from (
      select *
      from public.manpower_crew_audit_log
      order by created_at desc
      limit greatest(1, least(coalesce(p_limit, 100), 500))
    ) l
  );
end;
$$;

create or replace function public.manpower_admin_list_crew_audit(p_token uuid, p_limit int default 100)
returns jsonb
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.admin_list_crew_audit(p_token, p_limit); $$;

notify pgrst, 'reload schema';
