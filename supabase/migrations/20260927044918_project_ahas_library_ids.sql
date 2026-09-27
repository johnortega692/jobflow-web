-- One project AHA can be built from several library templates.

alter table public.project_ahas
  add column if not exists library_ids uuid[] not null default '{}';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'project_ahas'
      and column_name = 'library_id'
  ) then
    execute $backfill$
      update public.project_ahas
      set library_ids = array[library_id]
      where library_id is not null
        and cardinality(library_ids) = 0
    $backfill$;

    execute 'alter table public.project_ahas drop column library_id';
  end if;
end $$;
