-- Keep a Manpower Cal Upcoming entry in step when its GC activity is edited.

create or replace function public.jobflow_update_upcoming_from_gc(
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
  v_id text;
  v_title text;
  v_prev_title text;
  v_date date;
  v_prev_date date;
  v_week uuid;
  v_job uuid;
  v_event uuid;
  v_activity text;
  v_label text;
  v_created_by uuid;
  v_color text;
  v_updated jsonb := '[]'::jsonb;
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
      v_id := btrim(coalesce(v_item->>'id', ''));
      v_title := btrim(coalesce(v_item->>'title', ''));
      v_prev_title := btrim(coalesce(v_item->>'previous_title', ''));
      v_date := nullif(btrim(coalesce(v_item->>'event_date', '')), '')::date;
      v_prev_date := nullif(btrim(coalesce(v_item->>'previous_date', '')), '')::date;
      v_event := null;
      v_job := null;
      v_week := null;
      v_activity := '';

      if v_date is null or v_prev_date is null then
        raise exception 'EVENT_DATE_REQUIRED' using errcode = 'P0001';
      end if;
      if v_title = '' or v_prev_title = '' then
        raise exception 'EVENT_TITLE_REQUIRED' using errcode = 'P0001';
      end if;
      if char_length(v_title) > 120 or char_length(v_prev_title) > 120 then
        raise exception 'EVENT_TITLE_TOO_LONG' using errcode = 'P0001';
      end if;
      if v_date < manpower_api.monday_on(current_date) - (26 * 7) then
        raise exception 'EVENT_DATE_PAST' using errcode = 'P0001';
      end if;

      v_week := manpower_api.ensure_week_on(v_date);

      select e.id, e.schedule_job_id, coalesce(e.activity, '')
      into v_event, v_job, v_activity
      from public.manpower_coming_events e
      where e.event_date = v_prev_date
        and lower(btrim(e.title)) = lower(v_prev_title)
        and (e.project_id is null or e.project_id = p_project_id)
      order by (e.project_id = p_project_id) desc
      limit 1;

      if v_event is not null and exists (
        select 1
        from public.manpower_coming_events e
        where e.id <> v_event
          and e.event_date = v_date
          and lower(btrim(e.title)) = lower(v_title)
          and lower(btrim(coalesce(e.activity, ''))) = lower(btrim(v_activity))
      ) then
        raise exception 'EVENT_ALREADY_EXISTS' using errcode = 'P0001';
      end if;

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
        set name = v_title,
            project_id = coalesce(project_id, p_project_id)
        where id = v_job;
      end if;

      if v_event is null then
        insert into public.manpower_coming_events (event_date, title, project_id, created_by, schedule_job_id)
        values (v_date, v_title, p_project_id, v_created_by, v_job)
        returning id into v_event;
      else
        update public.manpower_coming_events
        set event_date = v_date,
            title = v_title,
            project_id = coalesce(p_project_id, project_id),
            schedule_job_id = v_job
        where id = v_event;
      end if;

      v_updated := v_updated || jsonb_build_array(v_id);
    exception
      when others then
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object(
            'id', coalesce(v_item->>'id', ''),
            'title', coalesce(v_item->>'title', ''),
            'code', sqlerrm
          )
        );
    end;
  end loop;

  return jsonb_build_object('updated', v_updated, 'errors', v_errors);
end;
$$;

revoke all on function public.jobflow_update_upcoming_from_gc(uuid, jsonb, uuid, text) from public;
grant execute on function public.jobflow_update_upcoming_from_gc(uuid, jsonb, uuid, text) to anon, authenticated;
