-- Schedule jobs that belong on the Hours Tracker for a week: a JobFlow project under one of its own
-- Manpower names, or a manual job that is not an Upcoming item. Upcoming activity rows are left out.

create or replace function manpower_api.list_hours_job_ids(p_token uuid, p_week_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, manpower_api
as $$
begin
  perform manpower_api.require_viewer(p_token);
  return coalesce((
    select jsonb_agg(j.id)
    from public.manpower_jobs j
    left join public.projects p on p.id = j.project_id
    where j.week_id = p_week_id
      and (
        (
          p.id is not null
          and exists (
            select 1
            from public.jobflow_project_trade_manpower_names(p.job_number, p.job_name, p.data) n
            where lower(btrim(n)) = lower(btrim(j.name))
          )
        )
        or (
          j.project_id is null
          and not exists (
            select 1 from public.manpower_coming_events e where e.schedule_job_id = j.id
          )
        )
      )
  ), '[]'::jsonb);
end;
$$;

create or replace function public.manpower_list_hours_job_ids(p_token uuid, p_week_id uuid)
returns jsonb
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.list_hours_job_ids(p_token, p_week_id); $$;

revoke all on function manpower_api.list_hours_job_ids(uuid, uuid) from public;
grant execute on function manpower_api.list_hours_job_ids(uuid, uuid) to anon, authenticated;
grant execute on function public.manpower_list_hours_job_ids(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
