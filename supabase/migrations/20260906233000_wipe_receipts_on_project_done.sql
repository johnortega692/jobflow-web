-- When a project is marked done, delete Field Tools receipt photos (DB rows +
-- Storage objects). Hide-from-Field-Tools stays a separate toggle.

create or replace function public.wipe_field_tools_receipts_for_project(p_project_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  if p_project_id is null then
    return 0;
  end if;

  perform set_config('storage.allow_delete_query', 'true', true);

  delete from storage.objects obj
  where obj.bucket_id = 'field-tools-receipts'
    and exists (
      select 1
      from public.field_tools_orders o
      where (
          obj.name = o.id::text
          or obj.name like (o.id::text || '/%')
        )
        and exists (
          select 1
          from public.projects p
          cross join lateral public.project_field_tools_job_numbers(p.job_number, p.data) n
          where p.id = p_project_id
            and trim(n) <> ''
            and (
              lower(trim(n)) = public.field_tools_order_job_code(o.job_number)
              or lower(trim(n)) = lower(trim(coalesce(o.job_number, '')))
            )
        )
    );

  delete from public.field_tools_order_receipts r
  where exists (
    select 1
    from public.field_tools_orders o
    where o.id = r.order_id
      and exists (
        select 1
        from public.projects p
        cross join lateral public.project_field_tools_job_numbers(p.job_number, p.data) n
        where p.id = p_project_id
          and trim(n) <> ''
          and (
            lower(trim(n)) = public.field_tools_order_job_code(o.job_number)
            or lower(trim(n)) = lower(trim(coalesce(o.job_number, '')))
          )
      )
  );

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.wipe_field_tools_receipts_for_project(uuid) from public;
revoke all on function public.wipe_field_tools_receipts_for_project(uuid) from anon, authenticated;

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

  perform public.wipe_field_tools_receipts_for_project(p_project_id);
  delete from public.manpower_jobs where project_id = p_project_id;
  delete from public.manpower_hours_jobs where project_id = p_project_id;
  delete from public.projects where id = p_project_id;
end;
$$;

notify pgrst, 'reload schema';
