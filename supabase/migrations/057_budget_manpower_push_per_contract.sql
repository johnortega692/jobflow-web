-- Per-contract budget hours push to Manpower (paint / wallcovering / FRP / track).

create or replace function public.jobflow_manpower_name_for_contract(
  p_job_number text,
  p_job_name text,
  p_data jsonb,
  p_contract text
)
returns text
language plpgsql
stable
as $$
declare
  ji jsonb := coalesce(p_data->'job_info', '{}'::jsonb);
  contract_key text := coalesce(nullif(lower(trim(p_contract)), ''), 'paint');
begin
  case contract_key
    when 'wallcovering' then
      return trim(public.jobflow_trade_manpower_name(
        p_job_number,
        p_job_name,
        coalesce(ji->>'wc_job_number', ''),
        coalesce(ji->>'wc_job_name', '')
      ));
    when 'frp' then
      return trim(public.jobflow_trade_manpower_name(
        p_job_number,
        p_job_name,
        coalesce(ji->>'frp_job_number', ''),
        coalesce(ji->>'frp_job_name', '')
      ));
    when 'track' then
      return trim(public.jobflow_trade_manpower_name(
        p_job_number,
        p_job_name,
        coalesce(ji->>'track_job_number', ''),
        coalesce(ji->>'track_job_name', '')
      ));
    else
      return trim(public.jobflow_trade_manpower_name(p_job_number, p_job_name, '', ''));
  end case;
end;
$$;

drop function if exists public.push_budget_hours_to_manpower(uuid, numeric);
drop function if exists public.push_budget_hours_to_manpower(uuid, numeric, boolean);

create or replace function public.push_budget_hours_to_manpower(
  p_project_id uuid,
  p_budgeted_hours numeric,
  p_include_supervision boolean default false,
  p_contract text default 'paint'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  proj record;
  v_job_name text;
  v_contract text;
  budget_blob jsonb;
  pushes jsonb;
  prior_push jsonb;
  pushed_at timestamptz;
  uid uuid := auth.uid();
begin
  if uid is null or not public.is_approved_user(uid) then
    raise exception 'Not authorized';
  end if;

  if p_budgeted_hours is null or p_budgeted_hours <= 0 then
    raise exception 'Budget hours must be greater than zero';
  end if;

  v_contract := coalesce(nullif(lower(trim(p_contract)), ''), 'paint');
  if v_contract not in ('paint', 'wallcovering', 'frp', 'track') then
    raise exception 'Invalid contract: %', p_contract;
  end if;

  select p.id, p.job_number, p.job_name, p.data
  into proj
  from public.projects p
  where p.id = p_project_id
  for update;

  if not found then
    raise exception 'Project not found';
  end if;

  v_job_name := public.jobflow_manpower_name_for_contract(
    proj.job_number,
    proj.job_name,
    proj.data,
    v_contract
  );
  if v_job_name = '' then
    raise exception 'Project must have a job number or name for the % contract', v_contract;
  end if;

  budget_blob := coalesce(proj.data->'budget_maker', '{}'::jsonb);
  pushes := coalesce(budget_blob->'manpower_budget_pushes', '{}'::jsonb);
  prior_push := pushes->v_contract;

  if nullif(prior_push->>'pushed_at', '') is not null then
    raise exception 'Budget hours for the % contract were already pushed to Manpower on %',
      v_contract,
      prior_push->>'pushed_at';
  end if;

  if v_contract = 'paint'
    and nullif(budget_blob->>'manpower_budget_pushed_at', '') is not null
    and pushes = '{}'::jsonb
  then
    raise exception 'Budget hours were already pushed to Manpower on %',
      budget_blob->>'manpower_budget_pushed_at';
  end if;

  insert into public.manpower_hours_jobs (job_name, project_id, budgeted_hours, updated_at)
  values (v_job_name, p_project_id, p_budgeted_hours, now())
  on conflict (job_name) do update set
    project_id = excluded.project_id,
    budgeted_hours = excluded.budgeted_hours,
    updated_at = now();

  pushed_at := now();

  pushes := pushes || jsonb_build_object(
    v_contract,
    jsonb_build_object(
      'pushed_at', pushed_at,
      'hours', p_budgeted_hours,
      'include_supervision', coalesce(p_include_supervision, false),
      'manpower_job_name', v_job_name,
      'pushed_by', uid::text
    )
  );

  budget_blob := budget_blob || jsonb_build_object('manpower_budget_pushes', pushes);

  if v_contract = 'paint' then
    budget_blob := budget_blob || jsonb_build_object(
      'manpower_budget_pushed_at', pushed_at,
      'manpower_budget_hours', p_budgeted_hours,
      'manpower_budget_pushed_by', uid::text,
      'manpower_budget_include_supervision', coalesce(p_include_supervision, false)
    );
  end if;

  update public.projects
  set
    data = jsonb_set(
      coalesce(data, '{}'::jsonb),
      '{budget_maker}',
      budget_blob,
      true
    ),
    updated_at = pushed_at,
    updated_by = uid
  where id = p_project_id;

  return jsonb_build_object(
    'job_name', v_job_name,
    'budgeted_hours', p_budgeted_hours,
    'pushed_at', pushed_at,
    'include_supervision', coalesce(p_include_supervision, false),
    'contract', v_contract
  );
end;
$$;

revoke all on function public.push_budget_hours_to_manpower(uuid, numeric, boolean, text) from public;
grant execute on function public.push_budget_hours_to_manpower(uuid, numeric, boolean, text) to authenticated;
