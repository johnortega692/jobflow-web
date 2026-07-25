-- Active projects for Company Workload "Needs planning" panel.
-- Same visibility rules as company_manpower_workload_json:
-- not hidden from field apps, not marked done in manpower,
-- and no planned manpower hours at all.

create or replace function public.company_manpower_active_projects_json()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'project_id', p.id,
        'job_number', p.job_number,
        'job_name', p.job_name
      )
      order by p.job_number, p.job_name
    ),
    '[]'::jsonb
  )
  from public.projects p
  where not public.project_hidden_from_field_apps(p.id)
    and not exists (
      select 1
      from public.manpower_project_status s
      where s.project_id = p.id and s.is_done
    )
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p.data->'billing'->'manpowerCells', '[]'::jsonb)) cell
      where coalesce(nullif(trim(cell->>'hours'), '')::numeric, 0) > 0
    );
$$;

revoke all on function public.company_manpower_active_projects_json() from public;

create or replace function public.get_company_manpower_active_projects()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.is_approved_user(uid) then
    raise exception 'Not authorized';
  end if;

  return public.company_manpower_active_projects_json();
end;
$$;

revoke all on function public.get_company_manpower_active_projects() from public;
grant execute on function public.get_company_manpower_active_projects() to authenticated;

create or replace function public.field_view_company_manpower_active_projects(
  p_caller_id uuid,
  p_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.field_view_require_access(p_caller_id, p_session_token);

  return public.company_manpower_active_projects_json();
end;
$$;

revoke all on function public.field_view_company_manpower_active_projects(uuid, text) from public;
grant execute on function public.field_view_company_manpower_active_projects(uuid, text) to anon, authenticated;
