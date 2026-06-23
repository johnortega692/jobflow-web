-- Record whether supervision (990) hours were included in the one-time Manpower push.

drop function if exists public.push_budget_hours_to_manpower(uuid, numeric);

create or replace function public.push_budget_hours_to_manpower(
  p_project_id uuid,
  p_budgeted_hours numeric,
  p_include_supervision boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  proj record;
  job_name text;
  budget_blob jsonb;
  pushed_at timestamptz;
  uid uuid := auth.uid();
begin
  if uid is null or not public.is_approved_user(uid) then
    raise exception 'Not authorized';
  end if;

  if p_budgeted_hours is null or p_budgeted_hours <= 0 then
    raise exception 'Budget hours must be greater than zero';
  end if;

  select p.id, p.job_number, p.job_name, p.data
  into proj
  from public.projects p
  where p.id = p_project_id
  for update;

  if not found then
    raise exception 'Project not found';
  end if;

  job_name := trim(coalesce(proj.job_number, '') || ' ' || coalesce(proj.job_name, ''));
  if job_name = '' then
    raise exception 'Project must have a job number or name';
  end if;

  budget_blob := coalesce(proj.data->'budget_maker', '{}'::jsonb);

  if nullif(budget_blob->>'manpower_budget_pushed_at', '') is not null then
    raise exception 'Budget hours were already pushed to Manpower on %',
      budget_blob->>'manpower_budget_pushed_at';
  end if;

  insert into public.manpower_hours_jobs (job_name, project_id, budgeted_hours, updated_at)
  values (job_name, p_project_id, p_budgeted_hours, now())
  on conflict (job_name) do update set
    project_id = excluded.project_id,
    budgeted_hours = excluded.budgeted_hours,
    updated_at = now();

  pushed_at := now();

  update public.projects
  set
    data = jsonb_set(
      coalesce(data, '{}'::jsonb),
      '{budget_maker}',
      budget_blob || jsonb_build_object(
        'manpower_budget_pushed_at', pushed_at,
        'manpower_budget_hours', p_budgeted_hours,
        'manpower_budget_pushed_by', uid::text,
        'manpower_budget_include_supervision', coalesce(p_include_supervision, false)
      ),
      true
    ),
    updated_at = pushed_at,
    updated_by = uid
  where id = p_project_id;

  return jsonb_build_object(
    'job_name', job_name,
    'budgeted_hours', p_budgeted_hours,
    'pushed_at', pushed_at,
    'include_supervision', coalesce(p_include_supervision, false)
  );
end;
$$;

revoke all on function public.push_budget_hours_to_manpower(uuid, numeric, boolean) from public;
grant execute on function public.push_budget_hours_to_manpower(uuid, numeric, boolean) to authenticated;
