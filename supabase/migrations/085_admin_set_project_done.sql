-- JobFlow admin: mark / reopen projects as done (same status Manpower Admin uses).

create or replace function public.admin_set_project_done(p_project_id uuid, p_done boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Admin required';
  end if;

  if p_project_id is null then
    raise exception 'Project id required';
  end if;

  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'Project not found';
  end if;

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

create or replace function public.project_is_done(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.manpower_project_status s
    where s.project_id = p_project_id and s.is_done
  );
$$;

create or replace function public.list_done_project_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.project_id
  from public.manpower_project_status s
  where s.is_done;
$$;

grant execute on function public.admin_set_project_done(uuid, boolean) to authenticated;
grant execute on function public.project_is_done(uuid) to authenticated;
grant execute on function public.list_done_project_ids() to authenticated;

notify pgrst, 'reload schema';
