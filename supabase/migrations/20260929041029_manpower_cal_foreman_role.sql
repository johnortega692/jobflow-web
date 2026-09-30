-- Add Foreman to the Manpower Cal role list. The existing foreman value stays Superintendent.

alter table public.manpower_employees drop constraint if exists manpower_employees_role_check;
alter table public.manpower_employees
  add constraint manpower_employees_role_check
  check (role in ('foreman', 'crew_foreman', 'leadman', 'apprentice', 'wallcovering', 'journeyman'));

alter table public.manpower_role_settings drop constraint if exists manpower_role_settings_role_check;
alter table public.manpower_role_settings
  add constraint manpower_role_settings_role_check
  check (role in ('foreman', 'crew_foreman', 'leadman', 'apprentice', 'wallcovering', 'journeyman'));

update public.manpower_role_settings
set sort_order = sort_order + 1,
    updated_at = now()
where sort_order >= 2
  and not exists (
    select 1 from public.manpower_role_settings where role = 'crew_foreman'
  );

insert into public.manpower_role_settings (role, sort_order, visible_in_add)
values ('crew_foreman', 2, true)
on conflict (role) do nothing;

create or replace function manpower_api.admin_set_role_visible(
  p_token uuid,
  p_role text,
  p_visible boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare visible_count int;
begin
  perform manpower_api.require_admin(p_token);

  if p_role not in ('foreman', 'crew_foreman', 'leadman', 'apprentice', 'wallcovering', 'journeyman') then
    raise exception 'INVALID_ROLE' using errcode = 'P0001';
  end if;

  if not p_visible then
    select count(*) into visible_count
    from public.manpower_role_settings
    where visible_in_add and role <> p_role;

    if visible_count = 0 then
      raise exception 'LAST_VISIBLE_ROLE' using errcode = 'P0001';
    end if;
  end if;

  update public.manpower_role_settings
  set visible_in_add = p_visible, updated_at = now()
  where role = p_role;

  return true;
end;
$$;

notify pgrst, 'reload schema';
