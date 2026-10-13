-- Login can show the JobFlow letterhead name before a PIN session.
-- Returns only company_name, not the rest of org_settings.

create or replace function public.manpower_company_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select nullif(trim(settings->>'company_name'), '')
      from public.org_settings
      where id = 1
    ),
    ''
  );
$$;

revoke all on function public.manpower_company_name() from public;
grant execute on function public.manpower_company_name() to anon, authenticated;
