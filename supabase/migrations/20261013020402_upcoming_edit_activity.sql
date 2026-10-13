-- Edit an Upcoming activity in place, and keep the schedule job name in step.

create or replace function manpower_api.update_coming_event(
  p_token uuid,
  p_event_id uuid,
  p_event_date date,
  p_title text,
  p_project_id uuid default null,
  p_activity text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  v_super public.manpower_supers;
  v_title text;
  v_activity text;
  v_week uuid;
  v_job uuid;
  v_old_job uuid;
  v_label text;
begin
  v_super := manpower_api.require_super(p_token);
  v_title := btrim(coalesce(p_title, ''));
  v_activity := btrim(coalesce(p_activity, ''));

  if p_event_id is null then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_event_date is null then
    raise exception 'EVENT_DATE_REQUIRED' using errcode = 'P0001';
  end if;
  if v_title = '' then
    raise exception 'EVENT_TITLE_REQUIRED' using errcode = 'P0001';
  end if;
  if char_length(v_title) > 120 or char_length(v_activity) > 120 then
    raise exception 'EVENT_TITLE_TOO_LONG' using errcode = 'P0001';
  end if;
  if lower(v_activity) = lower(v_title) then
    v_activity := '';
  end if;
  if p_project_id is not null and not exists (
    select 1 from public.projects p where p.id = p_project_id
  ) then
    raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0001';
  end if;

  select e.schedule_job_id
  into v_old_job
  from public.manpower_coming_events e
  where e.id = p_event_id;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.manpower_coming_events e
    where e.id <> p_event_id
      and e.event_date = p_event_date
      and lower(btrim(e.title)) = lower(v_title)
      and lower(btrim(coalesce(e.activity, ''))) = lower(v_activity)
  ) then
    raise exception 'EVENT_ALREADY_EXISTS' using errcode = 'P0001';
  end if;

  v_label := case
    when v_super.supervisor_label in ('Robert', 'John') then v_super.supervisor_label
    else null
  end;

  v_week := manpower_api.ensure_week_for_date(p_token, p_event_date);

  if v_old_job is not null and exists (
    select 1
    from public.manpower_jobs j
    where j.id = v_old_job
      and j.week_id = v_week
  ) then
    update public.manpower_jobs
    set name = v_title,
        project_id = p_project_id
    where id = v_old_job;
    v_job := v_old_job;
  else
    select j.id into v_job
    from public.manpower_jobs j
    where j.week_id = v_week
      and lower(btrim(j.name)) = lower(v_title)
    limit 1;

    if v_job is null then
      v_job := manpower_api.add_job(p_token, v_week, v_title, v_label, p_project_id);
    elsif p_project_id is not null then
      update public.manpower_jobs
      set project_id = p_project_id
      where id = v_job
        and project_id is null;
    end if;
  end if;

  update public.manpower_coming_events
  set event_date = p_event_date,
      title = v_title,
      activity = nullif(v_activity, ''),
      project_id = p_project_id,
      schedule_job_id = v_job
  where id = p_event_id;

  return manpower_api.coming_event_json(p_event_id);
end;
$$;

create or replace function public.manpower_update_coming_event(
  p_token uuid,
  p_event_id uuid,
  p_event_date date,
  p_title text,
  p_project_id uuid default null,
  p_activity text default null
)
returns jsonb
language sql
security invoker
set search_path = public, manpower_api
as $$
  select manpower_api.update_coming_event(
    p_token,
    p_event_id,
    p_event_date,
    p_title,
    p_project_id,
    p_activity
  );
$$;

revoke all on function manpower_api.update_coming_event(uuid, uuid, date, text, uuid, text) from public;
grant execute on function manpower_api.update_coming_event(uuid, uuid, date, text, uuid, text) to anon, authenticated;
grant execute on function public.manpower_update_coming_event(uuid, uuid, date, text, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
