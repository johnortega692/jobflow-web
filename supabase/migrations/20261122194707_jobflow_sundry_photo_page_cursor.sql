-- Page the sundry photo list without max(uuid), which Postgres does not provide.

create or replace function public.jobflow_admin_list_sundry_photos(
  p_query text default '',
  p_after uuid default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path to public
as $$
declare
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_limit integer := least(20, greatest(1, coalesce(p_limit, 20)));
  v_library jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_next uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.app_role = 'admin'
  ) then
    return jsonb_build_object('ok', false, 'error', 'Admin access required');
  end if;

  if p_after is null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'image_url', p.image_url
    ) order by p.name), '[]'::jsonb)
    into v_library
    from public.field_tools_sundry_library_photos p
    where v_query = '' or position(v_query in lower(p.name)) > 0;
  end if;

  select coalesce(jsonb_agg(picked.photo order by picked.id), '[]'::jsonb),
         count(*)::integer,
         (array_agg(picked.id order by picked.id desc))[1]
  into v_items, v_count, v_next
  from (
    select c.id, jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'image_url', c.image_url
    ) as photo
    from public.field_tools_catalog_items c
    where c.section = 'sundry'
      and c.active
      and c.image_url like 'data:image/jpeg%'
      and (p_after is null or c.id > p_after)
      and (
        v_query = ''
        or position(v_query in lower(c.name)) > 0
        or position(v_query in lower(coalesce(c.product_id, ''))) > 0
      )
    order by c.id
    limit v_limit
  ) picked;

  return jsonb_build_object(
    'ok', true,
    'photos', v_library || v_items,
    'next', case when v_count = v_limit then v_next else null end
  );
end;
$$;

revoke all on function public.jobflow_admin_list_sundry_photos(text, uuid, integer) from public, anon;
grant execute on function public.jobflow_admin_list_sundry_photos(text, uuid, integer) to authenticated;

notify pgrst, 'reload schema';
