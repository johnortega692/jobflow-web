-- Preview / demo sessions: live data, no edits.
-- PIN 2552 -> shared Preview account. John Ortega moves off 2552 (PIN set separately).

alter table public.manpower_supers
  add column if not exists is_preview boolean not null default false;

comment on column public.manpower_supers.is_preview is
  'When true, session can read live schedule data but all write RPCs are rejected.';

-- Any valid session (including preview)
create or replace function manpower_api.require_viewer(p_token uuid)
returns public.manpower_supers
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  s public.manpower_supers;
begin
  delete from public.manpower_sessions where expires_at <= now();
  select ms.* into s
  from public.manpower_sessions sess
  join public.manpower_supers ms on ms.id = sess.super_id
  where sess.token = p_token
    and sess.expires_at > now()
    and ms.active;
  if not found then
    raise exception 'INVALID_SESSION' using errcode = 'P0001';
  end if;
  return s;
end;
$$;

-- Write access: blocks preview sessions
create or replace function manpower_api.require_super(p_token uuid)
returns public.manpower_supers
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  s public.manpower_supers;
begin
  s := manpower_api.require_viewer(p_token);
  if s.is_preview then
    raise exception 'PREVIEW_READONLY' using errcode = 'P0001';
  end if;
  return s;
end;
$$;

create or replace function manpower_api.session_info(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  s public.manpower_supers;
begin
  s := manpower_api.require_viewer(p_token);
  return jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'is_admin', s.is_admin,
    'is_preview', s.is_preview,
    'supervisor_label', s.supervisor_label
  );
end;
$$;

-- get_state: preview may read live data without creating/syncing weeks
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
    select employee_id, jsonb_object_agg(day_key, cell_value) as days
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

create or replace function manpower_api.login(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, manpower_api, extensions
as $$
declare
  v_person public.org_people%rowtype;
  s public.manpower_supers%rowtype;
  tok uuid;
  exp timestamptz;
  match_count integer;
  v_lock_msg text;
begin
  if p_pin is null or length(trim(p_pin)) < 4 then
    return jsonb_build_object('ok', false, 'error', 'Enter at least 4 digits');
  end if;

  v_lock_msg := public.pin_lockout_error_message('manpower', p_pin);
  if v_lock_msg is not null then
    return jsonb_build_object('ok', false, 'error', v_lock_msg);
  end if;

  select count(*)::integer into match_count
  from public.org_people o
  where o.active
    and o.pin_hash is not null
    and o.pin_hash = extensions.crypt(trim(p_pin), o.pin_hash);

  if match_count = 0 then
    perform public.pin_apply_failed_login('manpower', p_pin);
    return jsonb_build_object('ok', false, 'error', 'Invalid PIN');
  end if;

  if match_count > 1 then
    return jsonb_build_object('ok', false, 'error', 'PIN is not unique — contact admin');
  end if;

  perform public.pin_clear_failed_login('manpower', p_pin);

  select * into v_person
  from public.org_people o
  where o.active
    and o.pin_hash is not null
    and o.pin_hash = extensions.crypt(trim(p_pin), o.pin_hash);

  select * into s
  from public.manpower_supers ms
  where ms.person_id = v_person.id
    and ms.active
  order by ms.is_admin desc, ms.updated_at desc
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'No Manpower Cal access for this PIN');
  end if;

  exp := now() + interval '12 hours';
  insert into public.manpower_sessions (super_id, expires_at)
  values (s.id, exp)
  returning token into tok;

  return jsonb_build_object(
    'ok', true,
    'token', tok,
    'expires_at', exp,
    'super', jsonb_build_object(
      'id', s.id,
      'name', v_person.name,
      'is_admin', s.is_admin,
      'is_preview', s.is_preview,
      'supervisor_label', s.supervisor_label
    )
  );
end;
$$;

create or replace function public.manpower_login_via_handoff_code(
  p_caller_id uuid,
  p_code uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, manpower_api, extensions
as $$
declare
  v_row public.field_tools_handoff_codes%rowtype;
  v_profile public.field_tools_profiles%rowtype;
  v_person public.org_people%rowtype;
  s public.manpower_supers%rowtype;
  tok uuid;
  exp timestamptz;
begin
  if p_caller_id is null or p_code is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_HANDOFF');
  end if;

  select * into v_row
  from public.field_tools_handoff_codes h
  where h.id = p_code
    and h.profile_id = p_caller_id
    and h.purpose = 'manpower'
    and h.used_at is null
    and h.expires_at > now()
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'INVALID_HANDOFF');
  end if;

  v_profile := public.field_tools_validate_session(v_row.profile_id, v_row.session_token);

  update public.field_tools_handoff_codes
  set used_at = now()
  where id = v_row.id;

  select * into v_person
  from public.org_people o
  where o.id = v_profile.person_id and o.active;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'INVALID_SESSION');
  end if;

  select * into s
  from public.manpower_supers ms
  where ms.person_id = v_person.id
    and ms.active
  order by ms.is_admin desc, ms.updated_at desc
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'NO_MANPOWER_ACCESS');
  end if;

  exp := now() + interval '12 hours';
  insert into public.manpower_sessions (super_id, expires_at)
  values (s.id, exp)
  returning token into tok;

  return jsonb_build_object(
    'ok', true,
    'token', tok,
    'expires_at', exp,
    'super', jsonb_build_object(
      'id', s.id,
      'name', v_person.name,
      'is_admin', s.is_admin,
      'is_preview', s.is_preview,
      'supervisor_label', s.supervisor_label
    )
  );
end;
$$;

-- Shared Preview identity: Manpower Cal only (no Field Tools profile).
-- Temporary PIN until John Ortega moves off 2552, then Preview gets 2552.
insert into public.org_people (name, email, pin_hash, active)
select
  'Preview',
  '',
  extensions.crypt('__preview_pending__', extensions.gen_salt('bf')),
  true
where not exists (
  select 1 from public.org_people o where lower(trim(o.name)) = 'preview' and o.active
);

insert into public.manpower_supers (person_id, name, pin_hash, supervisor_label, is_admin, is_preview, active)
select
  o.id,
  'Preview',
  o.pin_hash,
  null,
  false,
  true,
  true
from public.org_people o
where lower(trim(o.name)) = 'preview'
  and o.active
  and not exists (
    select 1 from public.manpower_supers ms where ms.person_id = o.id
  );

update public.manpower_supers ms
set is_preview = true,
    is_admin = false,
    name = 'Preview',
    pin_hash = coalesce(ms.pin_hash, o.pin_hash),
    updated_at = now()
from public.org_people o
where ms.person_id = o.id
  and lower(trim(o.name)) = 'preview';

-- Workforce list is read-only for preview; writes stay behind require_super
create or replace function manpower_api.list_workforce(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, manpower_api
as $$
begin
  perform manpower_api.require_viewer(p_token);
  return jsonb_build_object(
    'cert_types', manpower_api.cert_types_json(),
    'employees', (
      select coalesce(
        jsonb_agg(manpower_api.workforce_employee_json(e) order by e.active desc, e.sort_order, e.name),
        '[]'::jsonb
      )
      from public.manpower_employees e
    )
  );
end;
$$;
