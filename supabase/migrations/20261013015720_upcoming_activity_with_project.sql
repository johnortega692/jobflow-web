-- Keep the activity separate from the job name so Upcoming can show both.

alter table public.manpower_coming_events
  add column if not exists activity text;

alter table public.manpower_coming_events
  drop constraint if exists manpower_coming_events_activity_len;

alter table public.manpower_coming_events
  add constraint manpower_coming_events_activity_len
  check (activity is null or char_length(btrim(activity)) between 1 and 120);

drop index if exists public.manpower_coming_events_date_title_uidx;

create unique index if not exists manpower_coming_events_date_title_activity_uidx
  on public.manpower_coming_events (event_date, lower(btrim(title)), lower(btrim(coalesce(activity, ''))));

create or replace function manpower_api.coming_event_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', e.id,
    'event_date', e.event_date,
    'title', e.title,
    'activity', coalesce(e.activity, ''),
    'project_id', e.project_id,
    'created_by_name', coalesce(s.name, ''),
    'schedule_job_id', e.schedule_job_id,
    'week_id', w.id,
    'week_label', w.week_label,
    'week_start', w.week_start
  )
  from public.manpower_coming_events e
  left join public.manpower_supers s on s.id = e.created_by
  left join public.manpower_jobs j on j.id = e.schedule_job_id
  left join public.manpower_weeks w on w.id = j.week_id
  where e.id = p_id;
$$;

drop function if exists manpower_api.add_coming_event(uuid, date, text, uuid);

create or replace function manpower_api.add_coming_event(
  p_token uuid,
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
  v_event uuid;
  v_label text;
begin
  v_super := manpower_api.require_super(p_token);
  v_title := btrim(coalesce(p_title, ''));
  v_activity := btrim(coalesce(p_activity, ''));

  if p_event_date is null then
    raise exception 'EVENT_DATE_REQUIRED' using errcode = 'P0001';
  end if;
  if v_title = '' then
    raise exception 'EVENT_TITLE_REQUIRED' using errcode = 'P0001';
  end if;
  if char_length(v_title) > 120 then
    raise exception 'EVENT_TITLE_TOO_LONG' using errcode = 'P0001';
  end if;
  if char_length(v_activity) > 120 then
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

  v_label := case
    when v_super.supervisor_label in ('Robert', 'John') then v_super.supervisor_label
    else null
  end;

  select e.id, e.schedule_job_id
  into v_event, v_job
  from public.manpower_coming_events e
  where e.event_date = p_event_date
    and lower(btrim(e.title)) = lower(v_title)
    and lower(btrim(coalesce(e.activity, ''))) = lower(v_activity);

  v_week := manpower_api.ensure_week_for_date(p_token, p_event_date);

  if v_job is not null and not exists (
    select 1
    from public.manpower_jobs j
    where j.id = v_job
      and j.week_id = v_week
  ) then
    v_job := null;
  end if;

  if v_job is null then
    select j.id into v_job
    from public.manpower_jobs j
    where j.week_id = v_week
      and lower(btrim(j.name)) = lower(v_title)
    limit 1;
  end if;

  if v_job is null then
    v_job := manpower_api.add_job(p_token, v_week, v_title, v_label, p_project_id);
  elsif p_project_id is not null then
    update public.manpower_jobs
    set project_id = p_project_id
    where id = v_job
      and project_id is null;
  end if;

  if v_event is null then
    insert into public.manpower_coming_events (event_date, title, activity, project_id, created_by, schedule_job_id)
    values (p_event_date, v_title, nullif(v_activity, ''), p_project_id, v_super.id, v_job)
    returning id into v_event;
  else
    update public.manpower_coming_events
    set project_id = coalesce(p_project_id, project_id),
        activity = nullif(v_activity, ''),
        schedule_job_id = v_job
    where id = v_event;
  end if;

  return manpower_api.coming_event_json(v_event);
end;
$$;

drop function if exists public.manpower_add_coming_event(uuid, date, text, uuid);

create or replace function public.manpower_add_coming_event(
  p_token uuid,
  p_event_date date,
  p_title text,
  p_project_id uuid default null,
  p_activity text default null
)
returns jsonb
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.add_coming_event(p_token, p_event_date, p_title, p_project_id, p_activity); $$;

revoke all on function manpower_api.add_coming_event(uuid, date, text, uuid, text) from public;
grant execute on function manpower_api.add_coming_event(uuid, date, text, uuid, text) to anon, authenticated;
grant execute on function public.manpower_add_coming_event(uuid, date, text, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
