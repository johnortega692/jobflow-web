-- Allow any logged-in super to add crew; admin still required to edit/deactivate.

create or replace function manpower_api.admin_upsert_employee(
  p_token uuid,
  p_name text,
  p_role text default 'normal',
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
begin
  if p_employee_id is null then
    perform manpower_api.require_super(p_token);
    if p_name is null or length(trim(p_name)) < 1 then
      raise exception 'NAME_REQUIRED' using errcode = 'P0001';
    end if;
    insert into public.manpower_employees (name, role, sort_order)
    values (trim(p_name), coalesce(p_role, 'normal'), coalesce(p_sort_order, 0))
    returning id into eid;
  else
    perform manpower_api.require_admin(p_token);
    update public.manpower_employees
    set
      name = trim(p_name),
      role = coalesce(p_role, role),
      sort_order = coalesce(p_sort_order, sort_order)
    where id = p_employee_id
    returning id into eid;
  end if;
  return eid;
end;
$$;

notify pgrst, 'reload schema';
