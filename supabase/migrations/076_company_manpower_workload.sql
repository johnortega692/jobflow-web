-- Company-wide manpower plan rollup for workload calendar (office + Field View).

create or replace function public.company_manpower_workload_json(
  p_from_week date default null,
  p_to_week date default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'week_start', agg.week_start,
        'total_hours', agg.total_hours,
        'jobs', agg.jobs
      )
      order by agg.week_start
    ),
    '[]'::jsonb
  )
  from (
    select
      c.week_start,
      sum(c.hours)::numeric as total_hours,
      jsonb_agg(
        jsonb_build_object(
          'project_id', c.project_id,
          'job_number', c.job_number,
          'job_name', c.job_name,
          'phase_id', c.phase_id,
          'phase_name', c.phase_name,
          'hours', c.hours
        )
        order by c.job_number, c.phase_id
      ) as jobs
    from (
      select
        p.id as project_id,
        p.job_number,
        p.job_name,
        trim(cell->>'weekStartIso') as week_start,
        trim(cell->>'phaseId') as phase_id,
        case trim(cell->>'phaseId')
          when 'prime' then 'Prime'
          when 'final' then 'Final'
          when 'punch' then 'Touch-up'
          else coalesce(nullif(trim(cell->>'phaseId'), ''), 'Other')
        end as phase_name,
        coalesce(nullif(trim(cell->>'hours'), '')::numeric, 0) as hours
      from public.projects p
      cross join lateral jsonb_array_elements(coalesce(p.data->'billing'->'manpowerCells', '[]'::jsonb)) cell
      where coalesce(nullif(trim(cell->>'hours'), '')::numeric, 0) > 0
        and nullif(trim(cell->>'weekStartIso'), '') is not null
        and not public.project_hidden_from_field_apps(p.id)
        and not exists (
          select 1
          from public.manpower_project_status s
          where s.project_id = p.id and s.is_done
        )
    ) c
    where (p_from_week is null or c.week_start::date >= p_from_week)
      and (p_to_week is null or c.week_start::date <= p_to_week)
    group by c.week_start
  ) agg;
$$;

revoke all on function public.company_manpower_workload_json(date, date) from public;

create or replace function public.get_company_manpower_workload(
  p_from_week text default null,
  p_to_week text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_from date;
  v_to date;
begin
  if uid is null or not public.is_approved_user(uid) then
    raise exception 'Not authorized';
  end if;

  v_from := nullif(trim(coalesce(p_from_week, '')), '')::date;
  v_to := nullif(trim(coalesce(p_to_week, '')), '')::date;

  return public.company_manpower_workload_json(v_from, v_to);
end;
$$;

revoke all on function public.get_company_manpower_workload(text, text) from public;
grant execute on function public.get_company_manpower_workload(text, text) to authenticated;

create or replace function public.field_view_company_manpower_workload(
  p_caller_id uuid,
  p_session_token text,
  p_from_week text default null,
  p_to_week text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from date;
  v_to date;
begin
  perform public.field_view_require_access(p_caller_id, p_session_token);

  v_from := nullif(trim(coalesce(p_from_week, '')), '')::date;
  v_to := nullif(trim(coalesce(p_to_week, '')), '')::date;

  return public.company_manpower_workload_json(v_from, v_to);
end;
$$;

revoke all on function public.field_view_company_manpower_workload(uuid, text, text, text) from public;
grant execute on function public.field_view_company_manpower_workload(uuid, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
