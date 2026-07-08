-- Read-only active roster count for Company Workload chart (office + Field View).
-- Matches manpower_api.get_state employees filter: manpower_employees where active.

create or replace function public.company_manpower_active_crew_count()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.manpower_employees e
  where e.active;
$$;

revoke all on function public.company_manpower_active_crew_count() from public;

create or replace function public.get_company_manpower_active_crew()
returns int
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

  return public.company_manpower_active_crew_count();
end;
$$;

revoke all on function public.get_company_manpower_active_crew() from public;
grant execute on function public.get_company_manpower_active_crew() to authenticated;

create or replace function public.field_view_company_manpower_active_crew(
  p_caller_id uuid,
  p_session_token text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.field_view_require_access(p_caller_id, p_session_token);

  return public.company_manpower_active_crew_count();
end;
$$;

revoke all on function public.field_view_company_manpower_active_crew(uuid, text) from public;
grant execute on function public.field_view_company_manpower_active_crew(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
