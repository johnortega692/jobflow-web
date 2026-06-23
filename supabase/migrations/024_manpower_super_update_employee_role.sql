-- Allow any logged-in super (and admin) to update crew name/role on existing employees.

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
    perform manpower_api.require_super(p_token);
    if p_name is null or length(trim(p_name)) < 1 then
      raise exception 'NAME_REQUIRED' using errcode = 'P0001';
    end if;
    update public.manpower_employees
    set
      name = trim(p_name),
      role = case when coalesce(p_role, role) = 'normal' then 'journeyman' else coalesce(p_role, role) end,
      sort_order = coalesce(p_sort_order, sort_order)
    where id = p_employee_id
    returning id into eid;

    if eid is null then
      raise exception 'EMPLOYEE_NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;
  return eid;
end;
$$;

notify pgrst, 'reload schema';
