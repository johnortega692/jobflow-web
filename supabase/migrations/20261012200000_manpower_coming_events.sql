-- Coming events: a super adds a date and event, then it lands on that week's job list.

create table if not exists public.manpower_coming_events (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  title text not null,
  project_id uuid references public.projects(id) on delete set null,
  created_by uuid references public.manpower_supers(id) on delete set null,
  schedule_job_id uuid references public.manpower_jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint manpower_coming_events_title_len check (char_length(btrim(title)) between 1 and 120)
);

create index if not exists manpower_coming_events_event_date_idx
  on public.manpower_coming_events (event_date);

create unique index if not exists manpower_coming_events_date_title_uidx
  on public.manpower_coming_events (event_date, lower(btrim(title)));

alter table public.manpower_coming_events enable row level security;

revoke all on table public.manpower_coming_events from public, anon, authenticated;

comment on table public.manpower_coming_events is
  'Upcoming work a super added from Manpower Coming. schedule_job_id is the job list row for that week.';

create or replace function manpower_api.monday_on(p_date date)
returns date
language sql
immutable
as $$
  select p_date - ((extract(isodow from p_date)::int + 6) % 7);
$$;

-- Create any missing Monday weeks from the latest week through p_date's week.
create or replace function manpower_api.ensure_week_for_date(p_token uuid, p_date date)
returns uuid
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  v_monday date;
  v_this date;
  v_latest date;
  v_cur date;
  v_wid uuid;
  v_prev uuid;
  v_label text;
  v_existing_start date;
  v_guard int := 0;
begin
  perform manpower_api.require_super(p_token);

  if p_date is null then
    raise exception 'EVENT_DATE_REQUIRED' using errcode = 'P0001';
  end if;

  v_monday := manpower_api.monday_on(p_date);
  v_this := manpower_api.monday_on(current_date);

  if p_date < v_this - 14 then
    raise exception 'EVENT_DATE_PAST' using errcode = 'P0001';
  end if;
  if v_monday > v_this + (26 * 7) then
    raise exception 'EVENT_TOO_FAR' using errcode = 'P0001';
  end if;

  select id into v_wid from public.manpower_weeks where week_start = v_monday;
  if v_wid is not null then
    return v_wid;
  end if;

  select max(week_start) into v_latest from public.manpower_weeks;
  if v_latest is null then
    perform manpower_api.ensure_current_week(p_token);
    select max(week_start) into v_latest from public.manpower_weeks;
  end if;

  if v_latest is null then
    raise exception 'EVENT_TOO_FAR' using errcode = 'P0001';
  end if;

  if v_monday > v_latest then
    v_cur := v_latest;
    while v_cur < v_monday loop
      v_guard := v_guard + 1;
      if v_guard > 30 then
        raise exception 'EVENT_TOO_FAR' using errcode = 'P0001';
      end if;
      v_cur := v_cur + 7;
      v_label := manpower_api.week_label_for_date(v_cur);

      select id, week_start into v_wid, v_existing_start
      from public.manpower_weeks
      where week_start = v_cur;

      if v_wid is null then
        select id, week_start into v_wid, v_existing_start
        from public.manpower_weeks
        where week_label = v_label;
        if v_wid is not null and v_existing_start is distinct from v_cur then
          raise exception 'WEEK_LABEL_TAKEN' using errcode = 'P0001';
        end if;
      end if;

      if v_wid is null then
        insert into public.manpower_weeks (week_label, week_start)
        values (v_label, v_cur)
        returning id into v_wid;

        select id into v_prev
        from public.manpower_weeks
        where week_start = v_cur - 7
        limit 1;

        if v_prev is not null then
          perform manpower_api.copy_jobs_from_week(v_wid, v_prev);
        else
          perform manpower_api.ensure_training_job(v_wid);
        end if;
      end if;
    end loop;
    return v_wid;
  end if;

  v_label := manpower_api.week_label_for_date(v_monday);
  select id, week_start into v_wid, v_existing_start
  from public.manpower_weeks
  where week_label = v_label;
  if v_wid is not null and v_existing_start is distinct from v_monday then
    raise exception 'WEEK_LABEL_TAKEN' using errcode = 'P0001';
  end if;
  if v_wid is not null then
    return v_wid;
  end if;

  insert into public.manpower_weeks (week_label, week_start)
  values (v_label, v_monday)
  returning id into v_wid;

  select id into v_prev
  from public.manpower_weeks
  where week_start < v_monday
  order by week_start desc
  limit 1;

  if v_prev is not null then
    perform manpower_api.copy_jobs_from_week(v_wid, v_prev);
  else
    perform manpower_api.ensure_training_job(v_wid);
  end if;

  return v_wid;
end;
$$;

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

create or replace function manpower_api.list_coming_events(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  v_from date;
  v_to date;
begin
  perform manpower_api.require_viewer(p_token);
  v_from := manpower_api.monday_on(current_date) - 14;
  v_to := manpower_api.monday_on(current_date) + (27 * 7);

  return coalesce(
    (
      select jsonb_agg(manpower_api.coming_event_json(e.id) order by e.event_date, e.title)
      from public.manpower_coming_events e
      where e.event_date >= v_from
        and e.event_date < v_to
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function manpower_api.add_coming_event(
  p_token uuid,
  p_event_date date,
  p_title text,
  p_project_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  v_super public.manpower_supers;
  v_title text;
  v_week uuid;
  v_job uuid;
  v_event uuid;
  v_label text;
begin
  v_super := manpower_api.require_super(p_token);
  v_title := btrim(coalesce(p_title, ''));

  if p_event_date is null then
    raise exception 'EVENT_DATE_REQUIRED' using errcode = 'P0001';
  end if;
  if v_title = '' then
    raise exception 'EVENT_TITLE_REQUIRED' using errcode = 'P0001';
  end if;
  if char_length(v_title) > 120 then
    raise exception 'EVENT_TITLE_TOO_LONG' using errcode = 'P0001';
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
    and lower(btrim(e.title)) = lower(v_title);

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
    insert into public.manpower_coming_events (event_date, title, project_id, created_by, schedule_job_id)
    values (p_event_date, v_title, p_project_id, v_super.id, v_job)
    returning id into v_event;
  else
    update public.manpower_coming_events
    set project_id = coalesce(p_project_id, project_id),
        schedule_job_id = v_job
    where id = v_event;
  end if;

  return manpower_api.coming_event_json(v_event);
end;
$$;

create or replace function manpower_api.delete_coming_event(p_token uuid, p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, manpower_api
as $$
begin
  perform manpower_api.require_super(p_token);
  delete from public.manpower_coming_events where id = p_event_id;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  return true;
end;
$$;

create or replace function public.manpower_list_coming_events(p_token uuid)
returns jsonb
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.list_coming_events(p_token); $$;

create or replace function public.manpower_add_coming_event(
  p_token uuid,
  p_event_date date,
  p_title text,
  p_project_id uuid default null
)
returns jsonb
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.add_coming_event(p_token, p_event_date, p_title, p_project_id); $$;

create or replace function public.manpower_delete_coming_event(p_token uuid, p_event_id uuid)
returns boolean
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.delete_coming_event(p_token, p_event_id); $$;

revoke all on function manpower_api.monday_on(date) from public, anon, authenticated;
revoke all on function manpower_api.ensure_week_for_date(uuid, date) from public, anon, authenticated;
revoke all on function manpower_api.coming_event_json(uuid) from public, anon, authenticated;
revoke all on function manpower_api.list_coming_events(uuid) from public;
revoke all on function manpower_api.add_coming_event(uuid, date, text, uuid) from public;
revoke all on function manpower_api.delete_coming_event(uuid, uuid) from public;

grant execute on function manpower_api.list_coming_events(uuid) to anon, authenticated;
grant execute on function manpower_api.add_coming_event(uuid, date, text, uuid) to anon, authenticated;
grant execute on function manpower_api.delete_coming_event(uuid, uuid) to anon, authenticated;

grant execute on function public.manpower_list_coming_events(uuid) to anon, authenticated;
grant execute on function public.manpower_add_coming_event(uuid, date, text, uuid) to anon, authenticated;
grant execute on function public.manpower_delete_coming_event(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
