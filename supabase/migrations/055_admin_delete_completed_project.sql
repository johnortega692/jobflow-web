-- JobFlow admin: permanently delete projects marked done in Manpower.

create or replace function public.admin_list_completed_projects()
returns table (
  id uuid,
  job_number text,
  job_name text,
  marked_done_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select p.id, p.job_number, p.job_name, s.marked_done_at
  from public.projects p
  join public.manpower_project_status s on s.project_id = p.id and s.is_done = true
  order by s.marked_done_at desc nulls last, p.job_number;
$$;

create or replace function public.admin_delete_completed_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Admin required';
  end if;

  if not exists (
    select 1
    from public.manpower_project_status s
    where s.project_id = p_project_id and s.is_done = true
  ) then
    raise exception 'Project must be marked done in Manpower before permanent deletion';
  end if;

  delete from public.manpower_jobs where project_id = p_project_id;
  delete from public.manpower_hours_jobs where project_id = p_project_id;
  delete from public.projects where id = p_project_id;
end;
$$;

grant execute on function public.admin_list_completed_projects() to authenticated;
grant execute on function public.admin_delete_completed_project(uuid) to authenticated;

drop policy if exists "projects_delete" on public.projects;
create policy "projects_delete" on public.projects
  for delete to authenticated
  using (public.is_app_admin());

notify pgrst, 'reload schema';
