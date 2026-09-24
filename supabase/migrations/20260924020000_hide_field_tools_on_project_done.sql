-- Mark completed also hides the job from Field Tools / Field View.
-- Reopen restores visibility. Same helper as the Job setup checkbox.

create or replace function public.apply_project_field_app_visibility(
  p_project_id uuid,
  p_hidden boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  proj record;
  job_num text;
  next_status text;
begin
  if p_project_id is null then
    return false;
  end if;

  select p.id, p.job_number, p.data
  into proj
  from public.projects p
  where p.id = p_project_id;

  if not found then
    return false;
  end if;

  insert into public.project_field_app_visibility (project_id, hidden_from_field_apps, updated_at)
  values (p_project_id, p_hidden, now())
  on conflict (project_id) do update
    set hidden_from_field_apps = excluded.hidden_from_field_apps,
        updated_at = now();

  next_status := case when p_hidden then 'hidden' else 'active' end;

  for job_num in
    select distinct n
    from public.project_field_tools_job_numbers(proj.job_number, proj.data) n
    where trim(n) <> ''
  loop
    update public.field_tools_jobs
    set status = next_status, updated_at = now()
    where lower(trim(job_number)) = lower(trim(job_num));
  end loop;

  if p_hidden then
    delete from public.manpower_jobs where project_id = p_project_id;
  end if;

  return p_hidden;
end;
$$;

revoke all on function public.apply_project_field_app_visibility(uuid, boolean) from public, anon, authenticated;

create or replace function public.set_project_field_app_visibility(
  p_project_id uuid,
  p_hidden boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.is_approved_user(uid) then
    raise exception 'Not authorized';
  end if;

  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'Project not found';
  end if;

  perform public.apply_project_field_app_visibility(p_project_id, p_hidden);
  return p_hidden;
end;
$$;

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
    perform public.wipe_field_tools_receipts_for_project(p_project_id);
    insert into public.manpower_project_status (project_id, is_done, marked_done_at, updated_at)
    values (p_project_id, true, now(), now())
    on conflict (project_id) do update
      set is_done = true, marked_done_at = now(), updated_at = now();
    perform public.apply_project_field_app_visibility(p_project_id, true);
  else
    insert into public.manpower_project_status (project_id, is_done, marked_active_at, updated_at)
    values (p_project_id, false, now(), now())
    on conflict (project_id) do update
      set is_done = false, marked_active_at = now(), updated_at = now();
    perform public.apply_project_field_app_visibility(p_project_id, false);
  end if;

  return true;
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
    perform public.wipe_field_tools_receipts_for_project(p_project_id);
    insert into public.manpower_project_status (project_id, is_done, marked_done_at, updated_at)
    values (p_project_id, true, now(), now())
    on conflict (project_id) do update
      set is_done = true, marked_done_at = now(), updated_at = now();
    perform public.apply_project_field_app_visibility(p_project_id, true);
  else
    insert into public.manpower_project_status (project_id, is_done, marked_active_at, updated_at)
    values (p_project_id, false, now(), now())
    on conflict (project_id) do update
      set is_done = false, marked_active_at = now(), updated_at = now();
    perform public.apply_project_field_app_visibility(p_project_id, false);
  end if;
  return true;
end;
$$;

-- Already-completed jobs should also drop off Field Tools.
do $$
declare
  rec record;
begin
  for rec in
    select s.project_id
    from public.manpower_project_status s
    where s.is_done
  loop
    perform public.apply_project_field_app_visibility(rec.project_id, true);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
