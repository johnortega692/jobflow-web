-- Register paint + trade contract jobs (WC / FRP / track) in Manpower and auto-sync weekly schedule.

create or replace function public.jobflow_trade_manpower_name(
  p_primary_number text,
  p_primary_name text,
  p_override_number text,
  p_override_name text
)
returns text
language sql
immutable
as $$
  select trim(
    coalesce(nullif(trim(p_override_number), ''), trim(p_primary_number))
    || ' '
    || coalesce(nullif(trim(p_override_name), ''), trim(p_primary_name))
  );
$$;

create or replace function public.jobflow_project_trade_manpower_names(
  p_job_number text,
  p_job_name text,
  p_data jsonb
)
returns setof text
language plpgsql
stable
as $$
declare
  ji jsonb := coalesce(p_data->'job_info', '{}'::jsonb);
  paint_name text;
  trade_name text;
  seen text[] := array[]::text[];
begin
  paint_name := trim(public.jobflow_trade_manpower_name(p_job_number, p_job_name, '', ''));
  if paint_name <> '' then
    seen := array_append(seen, lower(paint_name));
    return next paint_name;
  end if;

  if coalesce(ji->>'has_wallcovering', 'false')::boolean then
    trade_name := trim(public.jobflow_trade_manpower_name(
      p_job_number,
      p_job_name,
      coalesce(ji->>'wc_job_number', ''),
      coalesce(ji->>'wc_job_name', '')
    ));
    if trade_name <> '' and not (lower(trade_name) = any(seen)) then
      seen := array_append(seen, lower(trade_name));
      return next trade_name;
    end if;
  end if;

  if coalesce(ji->>'has_frp', 'false')::boolean then
    trade_name := trim(public.jobflow_trade_manpower_name(
      p_job_number,
      p_job_name,
      coalesce(ji->>'frp_job_number', ''),
      coalesce(ji->>'frp_job_name', '')
    ));
    if trade_name <> '' and not (lower(trade_name) = any(seen)) then
      seen := array_append(seen, lower(trade_name));
      return next trade_name;
    end if;
  end if;

  if coalesce(ji->>'has_track', 'false')::boolean then
    trade_name := trim(public.jobflow_trade_manpower_name(
      p_job_number,
      p_job_name,
      coalesce(ji->>'track_job_number', ''),
      coalesce(ji->>'track_job_name', '')
    ));
    if trade_name <> '' and not (lower(trade_name) = any(seen)) then
      return next trade_name;
    end if;
  end if;

  return;
end;
$$;

create or replace function public.register_project_trade_jobs(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  proj record;
  v_name text;
  rows jsonb := '[]'::jsonb;
  uid uuid := auth.uid();
begin
  if uid is null or not public.is_approved_user(uid) then
    raise exception 'Not authorized';
  end if;

  select p.id, p.job_number, p.job_name, p.data
  into proj
  from public.projects p
  where p.id = p_project_id;

  if not found then
    raise exception 'Project not found';
  end if;

  for v_name in
    select distinct n
    from public.jobflow_project_trade_manpower_names(proj.job_number, proj.job_name, proj.data) n
    where trim(n) <> ''
  loop
    insert into public.manpower_hours_jobs (job_name, project_id, budgeted_hours, updated_at)
    values (v_name, p_project_id, 0, now())
    on conflict (job_name) do update set
      project_id = excluded.project_id,
      updated_at = now();

    rows := rows || jsonb_build_array(
      jsonb_build_object(
        'job_name', v_name,
        'ok', true,
        'message', 'Registered in Manpower hours tracker.'
      )
    );
  end loop;

  if jsonb_array_length(rows) = 0 then
    raise exception 'Project must have a job number or name';
  end if;

  return rows;
end;
$$;

revoke all on function public.register_project_trade_jobs(uuid) from public;
grant execute on function public.register_project_trade_jobs(uuid) to authenticated;

create or replace function public.upsert_field_tools_job(
  p_job_number text,
  p_job_name text,
  p_address text,
  p_superintendent text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  clean_number text := trim(p_job_number);
begin
  if uid is null or not public.is_approved_user(uid) then
    raise exception 'Not authorized';
  end if;
  if clean_number = '' then
    raise exception 'Job number is required';
  end if;

  update public.field_tools_jobs
  set
    job_name = coalesce(nullif(trim(p_job_name), ''), job_name),
    address = coalesce(nullif(trim(p_address), ''), address),
    superintendent = coalesce(nullif(trim(p_superintendent), ''), superintendent),
    status = 'active',
    updated_at = now()
  where lower(trim(job_number)) = lower(clean_number);

  if found then
    return;
  end if;

  insert into public.field_tools_jobs (job_number, job_name, address, superintendent, status, updated_at)
  values (
    clean_number,
    coalesce(nullif(trim(p_job_name), ''), ''),
    coalesce(nullif(trim(p_address), ''), ''),
    coalesce(nullif(trim(p_superintendent), ''), ''),
    'active',
    now()
  );
end;
$$;

revoke all on function public.upsert_field_tools_job(text, text, text, text) from public;
grant execute on function public.upsert_field_tools_job(text, text, text, text) to authenticated;

create or replace function manpower_api.sync_jobflow_projects(p_token uuid, p_week_id uuid)
returns int
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  added int := 0;
  rec record;
  v_name text;
begin
  perform manpower_api.require_super(p_token);
  for rec in
    select p.id, p.job_number, p.job_name, p.data
    from public.projects p
    where not exists (
      select 1
      from public.manpower_project_status s
      where s.project_id = p.id and s.is_done
    )
    order by p.job_number
  loop
    for v_name in
      select distinct n
      from public.jobflow_project_trade_manpower_names(rec.job_number, rec.job_name, rec.data) n
      where trim(n) <> ''
    loop
      if not exists (
        select 1
        from public.manpower_jobs j
        where j.week_id = p_week_id and lower(j.name) = lower(v_name)
      ) then
        perform manpower_api.add_job(p_token, p_week_id, v_name, null, rec.id);
        added := added + 1;
      end if;
    end loop;
  end loop;
  return added;
end;
$$;
