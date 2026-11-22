-- JobFlow's invoice add form needs every sundry category, including ones with no items yet.

create or replace function public.jobflow_admin_list_sundry_categories()
returns jsonb
language plpgsql
stable
security definer
set search_path to public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.app_role = 'admin'
  ) then
    return jsonb_build_object('ok', false, 'error', 'Admin access required');
  end if;

  return jsonb_build_object(
    'ok', true,
    'categories', coalesce((
      select jsonb_agg(name order by name)
      from (
        select btrim(c.name) as name
        from public.field_tools_sundry_categories c
        where btrim(c.name) <> ''
        union
        select btrim(i.category) as name
        from public.field_tools_catalog_items i
        where i.active
          and i.section = 'sundry'
          and btrim(i.category) <> ''
      ) names
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.jobflow_admin_list_sundry_categories() from public, anon;
grant execute on function public.jobflow_admin_list_sundry_categories() to authenticated;

notify pgrst, 'reload schema';
