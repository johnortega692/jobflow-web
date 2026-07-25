-- Needs planning: active projects with no planned manpower hours at all.

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
