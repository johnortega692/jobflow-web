-- GC Upcoming can include the past six months, and is not capped going forward.
-- Week labels are M/D and unique, so a date about a year out gets M/D/YYYY
-- when that month/day already belongs to another year.

create or replace function manpower_api.week_label_available(p_monday date)
returns text
language sql
stable
set search_path = public, manpower_api
as $$
  select case
    when not exists (
      select 1
      from public.manpower_weeks w
      where w.week_label = manpower_api.week_label_for_date(p_monday)
        and w.week_start is distinct from p_monday
    ) then manpower_api.week_label_for_date(p_monday)
    else manpower_api.week_label_for_date(p_monday) || '/' || to_char(p_monday, 'YYYY')
  end;
$$;

create or replace function manpower_api.ensure_week_on(p_date date)
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
  v_guard int := 0;
begin
  if p_date is null then
    raise exception 'EVENT_DATE_REQUIRED' using errcode = 'P0001';
  end if;

  v_monday := manpower_api.monday_on(p_date);
  v_this := manpower_api.monday_on(current_date);

  select id into v_wid from public.manpower_weeks where week_start = v_monday;
  if v_wid is not null then
    return v_wid;
  end if;

  select max(week_start) into v_latest from public.manpower_weeks;
  if v_latest is null then
    v_label := manpower_api.week_label_available(v_this);
    insert into public.manpower_weeks (week_label, week_start)
    values (v_label, v_this)
    returning id into v_wid;
    perform manpower_api.ensure_training_job(v_wid);
    perform manpower_api.ensure_training_hours_row();
    if v_this = v_monday then
      return v_wid;
    end if;
    select max(week_start) into v_latest from public.manpower_weeks;
  end if;

  if v_latest is null then
    raise exception 'EVENT_TOO_FAR' using errcode = 'P0001';
  end if;

  if v_monday > v_latest then
    v_cur := v_latest;
    while v_cur < v_monday loop
      v_guard := v_guard + 1;
      -- Safety stop only. A year-long GC schedule is well inside this.
      if v_guard > 160 then
        raise exception 'EVENT_TOO_FAR' using errcode = 'P0001';
      end if;
      v_cur := v_cur + 7;
      v_label := manpower_api.week_label_available(v_cur);

      select id into v_wid
      from public.manpower_weeks
      where week_start = v_cur;

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

  v_label := manpower_api.week_label_available(v_monday);
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

create or replace function public.jobflow_add_upcoming_from_gc(
  p_project_id uuid,
  p_items jsonb,
  p_caller_id uuid default null,
  p_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  v_item jsonb;
  v_title text;
  v_date date;
  v_week uuid;
  v_job uuid;
  v_event uuid;
  v_label text;
  v_created_by uuid;
  v_color text;
  v_added int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_count int;
begin
  perform public.field_view_require_access(p_caller_id, p_session_token);

  if p_project_id is null or not exists (
    select 1 from public.projects p where p.id = p_project_id
  ) then
    raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'EVENT_TITLE_REQUIRED' using errcode = 'P0001';
  end if;

  select count(*)::int into v_count from jsonb_array_elements(p_items);
  if v_count > 200 then
    raise exception 'EVENT_TOO_FAR' using errcode = 'P0001';
  end if;

  select s.id,
         case
           when s.supervisor_label in ('Robert', 'John') then s.supervisor_label
           else null
         end
  into v_created_by, v_label
  from public.manpower_supers s
  where s.active
    and s.person_id = coalesce(auth.uid(), p_caller_id)
  order by s.is_admin desc
  limit 1;

  v_color := case
    when v_label = 'Robert' then '#ffff00'
    when v_label = 'John' then '#ff9900'
    else '#ffffff'
  end;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_title := btrim(coalesce(v_item->>'title', ''));
      v_date := nullif(btrim(coalesce(v_item->>'event_date', '')), '')::date;
      v_event := null;
      v_job := null;
      v_week := null;

      if v_date is null then
        raise exception 'EVENT_DATE_REQUIRED' using errcode = 'P0001';
      end if;
      if v_title = '' then
        raise exception 'EVENT_TITLE_REQUIRED' using errcode = 'P0001';
      end if;
      if char_length(v_title) > 120 then
        raise exception 'EVENT_TITLE_TOO_LONG' using errcode = 'P0001';
      end if;
      if v_date < manpower_api.monday_on(current_date) - (26 * 7) then
        raise exception 'EVENT_DATE_PAST' using errcode = 'P0001';
      end if;

      v_week := manpower_api.ensure_week_on(v_date);

      select e.id, e.schedule_job_id
      into v_event, v_job
      from public.manpower_coming_events e
      where e.event_date = v_date
        and lower(btrim(e.title)) = lower(v_title);

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
        insert into public.manpower_jobs (week_id, name, project_id, supervisor_label, row_color, sort_order)
        values (
          v_week,
          v_title,
          p_project_id,
          v_label,
          v_color,
          (select coalesce(max(sort_order), 0) + 1 from public.manpower_jobs where week_id = v_week)
        )
        returning id into v_job;
      else
        update public.manpower_jobs
        set project_id = p_project_id
        where id = v_job
          and project_id is null;
      end if;

      if v_event is null then
        insert into public.manpower_coming_events (event_date, title, project_id, created_by, schedule_job_id)
        values (v_date, v_title, p_project_id, v_created_by, v_job)
        returning id into v_event;
      else
        update public.manpower_coming_events
        set project_id = coalesce(p_project_id, project_id),
            schedule_job_id = v_job
        where id = v_event;
      end if;

      v_added := v_added + 1;
    exception
      when others then
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object(
            'title', coalesce(v_item->>'title', ''),
            'code', sqlerrm
          )
        );
    end;
  end loop;

  return jsonb_build_object('added', v_added, 'errors', v_errors);
end;
$$;

revoke all on function manpower_api.week_label_available(date) from public, anon, authenticated;
revoke all on function manpower_api.ensure_week_on(date) from public, anon, authenticated;

revoke all on function public.jobflow_add_upcoming_from_gc(uuid, jsonb, uuid, text) from public;
grant execute on function public.jobflow_add_upcoming_from_gc(uuid, jsonb, uuid, text) to anon, authenticated;
