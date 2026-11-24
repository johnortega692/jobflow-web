-- Live week updates for Manpower Cal.
-- Existing 5-arg set_assignment calls keep working: p_expected_updated_at defaults to null
-- and then the write path is unchanged. Not applied until reviewed.

drop function if exists public.manpower_set_assignment(uuid, uuid, uuid, text, text);
drop function if exists manpower_api.set_assignment(uuid, uuid, uuid, text, text);

create or replace function manpower_api.set_assignment(
  p_token uuid,
  p_week_id uuid,
  p_employee_id uuid,
  p_day_key text,
  p_value text,
  p_expected_updated_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  s public.manpower_supers;
  old_val text := '';
  row_updated_at timestamptz;
  row_found boolean := false;
  new_val text := coalesce(p_value, '');
  emp_name text;
  week_lbl text;
begin
  s := manpower_api.require_super(p_token);

  select a.cell_value, a.updated_at
  into old_val, row_updated_at
  from public.manpower_assignments a
  where a.week_id = p_week_id
    and a.employee_id = p_employee_id
    and a.day_key = p_day_key;

  row_found := found;
  old_val := coalesce(old_val, '');

  if p_expected_updated_at is not null
     and (not row_found or row_updated_at is distinct from p_expected_updated_at) then
    raise exception 'CELL_CONFLICT' using errcode = 'P0001';
  end if;

  insert into public.manpower_assignments (week_id, employee_id, day_key, cell_value, updated_at)
  values (p_week_id, p_employee_id, p_day_key, new_val, now())
  on conflict (week_id, employee_id, day_key) do update
    set cell_value = excluded.cell_value, updated_at = now();

  if old_val is distinct from new_val then
    select e.name into emp_name from public.manpower_employees e where e.id = p_employee_id;
    select w.week_label into week_lbl from public.manpower_weeks w where w.id = p_week_id;

    insert into public.manpower_crew_audit_log (
      super_id, super_name, week_id, week_label, employee_id, employee_name, day_key, old_value, new_value
    )
    values (
      s.id,
      s.name,
      p_week_id,
      coalesce(week_lbl, '?'),
      p_employee_id,
      coalesce(emp_name, '?'),
      p_day_key,
      old_val,
      new_val
    );

    begin
      perform manpower_api.maybe_queue_fsi_budget_alert(
        p_week_id, p_employee_id, p_day_key, new_val
      );
    exception
      when others then
        null;
    end;
  end if;

  -- A missing Realtime partition raises inside realtime.send. Keep the cell
  -- write if the broadcast itself fails.
  begin
    perform realtime.send(
      jsonb_build_object(
        'week_id', p_week_id,
        'super_id', s.id,
        'super_name', s.name,
        'at', now()
      ),
      'week_changed',
      'manpower:week:' || p_week_id::text,
      false
    );
  exception
    when others then
      null;
  end;

  return true;
end;
$$;

create or replace function public.manpower_set_assignment(
  p_token uuid,
  p_week_id uuid,
  p_employee_id uuid,
  p_day_key text,
  p_value text,
  p_expected_updated_at timestamptz default null
) returns boolean
language sql
security invoker
set search_path = public, manpower_api
as $$
  select manpower_api.set_assignment(
    p_token,
    p_week_id,
    p_employee_id,
    p_day_key,
    p_value,
    p_expected_updated_at
  );
$$;

grant execute on function manpower_api.set_assignment(uuid, uuid, uuid, text, text, timestamptz) to anon, authenticated;
grant execute on function public.manpower_set_assignment(uuid, uuid, uuid, text, text, timestamptz) to anon, authenticated;

-- Cells were plain strings. Each cell is now { value, updated_at }.
-- value stays the same text current callers already read.
create or replace function manpower_api.get_state(p_token uuid, p_week_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  v_viewer public.manpower_supers;
  wid uuid;
  assign_map jsonb := '{}'::jsonb;
  rec record;
begin
  v_viewer := manpower_api.require_viewer(p_token);

  if v_viewer.is_preview then
    wid := coalesce(
      p_week_id,
      (select w.id from public.manpower_weeks w order by w.week_start desc limit 1)
    );
    if wid is null then
      raise exception 'NO_WEEK_DATA' using errcode = 'P0001';
    end if;
  else
    wid := coalesce(p_week_id, manpower_api.ensure_current_week(p_token));
    perform manpower_api.ensure_training_job(wid);
    perform manpower_api.ensure_training_hours_row();
    perform manpower_api.sync_jobflow_projects(p_token, wid);
  end if;

  for rec in
    select employee_id,
           jsonb_object_agg(
             day_key,
             jsonb_build_object('value', cell_value, 'updated_at', updated_at)
           ) as days
    from public.manpower_assignments
    where week_id = wid
    group by employee_id
  loop
    assign_map := assign_map || jsonb_build_object(rec.employee_id::text, rec.days);
  end loop;

  return jsonb_build_object(
    'week', (
      select jsonb_build_object('id', w.id, 'week_label', w.week_label, 'week_start', w.week_start)
      from public.manpower_weeks w
      where w.id = wid
    ),
    'weeks', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object('id', w.id, 'week_label', w.week_label, 'week_start', w.week_start)
          order by w.week_start desc
        ),
        '[]'::jsonb
      )
      from public.manpower_weeks w
    ),
    'employees', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object('id', e.id, 'name', e.name, 'role', e.role, 'sort_order', e.sort_order)
          order by e.sort_order, e.name
        ),
        '[]'::jsonb
      )
      from public.manpower_employees e
      where e.active
    ),
    'jobs', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', j.id,
            'name', j.name,
            'project_id', j.project_id,
            'supervisor_label', j.supervisor_label,
            'row_color', j.row_color,
            'sort_order', j.sort_order
          )
          order by j.sort_order, j.name
        ),
        '[]'::jsonb
      )
      from public.manpower_jobs j
      where j.week_id = wid
        and manpower_api.job_is_visible(j.project_id, j.name)
    ),
    'assignments', assign_map,
    'transfer_options', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object('id', t.id, 'am_job', t.am_job, 'pm_job', t.pm_job, 'active', t.active)
        ),
        '[]'::jsonb
      )
      from public.manpower_transfer_options t
      where t.active
    ),
    'hours_tracker', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', h.id,
            'job_name', h.job_name,
            'project_id', h.project_id,
            'budgeted_hours', h.budgeted_hours,
            'week_hours', h.week_hours,
            'start_date', h.start_date,
            'is_training_overhead', h.is_training_overhead,
            'training_log', h.training_log
          )
          order by h.is_training_overhead desc, h.job_name
        ),
        '[]'::jsonb
      )
      from public.manpower_hours_jobs h
      where h.is_training_overhead
        or h.project_id is null
        or not public.project_hidden_from_field_apps(h.project_id)
    ),
    'project_options', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'job_number', p.job_number,
            'job_name', p.job_name,
            'label', trim(p.job_number || ' ' || p.job_name)
          )
          order by p.job_number
        ),
        '[]'::jsonb
      )
      from public.projects p
      where not exists (
        select 1
        from public.manpower_project_status mps
        where mps.project_id = p.id and mps.is_done
      )
        and not public.project_hidden_from_field_apps(p.id)
    ),
    'assignment_statuses', manpower_api.assignment_statuses_json(),
    'role_settings', manpower_api.role_settings_json()
  );
end;
$$;

notify pgrst, 'reload schema';
