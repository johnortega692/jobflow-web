-- JobFlow admins can attach a sundry photo while adding an item, and browse existing photos.

create or replace function public.jobflow_admin_add_material_item(p_item jsonb)
returns jsonb
language plpgsql
security definer
set search_path to public
as $$
declare
  v_section text;
  v_name text;
  v_category text;
  v_product_id text;
  v_vendor text;
  v_vendor_id uuid;
  v_cost numeric;
  v_image text;
  v_id uuid;
  v_item jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.app_role = 'admin'
  ) then
    return jsonb_build_object('ok', false, 'error', 'Admin access required');
  end if;

  v_section := btrim(coalesce(p_item->>'section', ''));
  v_name := btrim(coalesce(p_item->>'name', ''));
  v_category := btrim(coalesce(p_item->>'category', ''));
  v_product_id := btrim(coalesce(p_item->>'product_id', ''));
  v_vendor := btrim(coalesce(p_item->>'vendor_name', ''));
  v_image := btrim(coalesce(p_item->>'image_url', ''));

  if v_section not in ('sundry', 'paint_product') then
    return jsonb_build_object('ok', false, 'error', 'Choose Sundries or Paint.');
  end if;
  if v_name = '' then
    return jsonb_build_object('ok', false, 'error', 'Enter a name.');
  end if;
  if char_length(v_name) > 120 or char_length(v_category) > 80 or char_length(v_product_id) > 80 then
    return jsonb_build_object('ok', false, 'error', 'Name, category, or product ID is too long.');
  end if;
  if v_image <> '' then
    if v_section <> 'sundry' then
      return jsonb_build_object('ok', false, 'error', 'Photos can be added to sundries.');
    end if;
    if v_image not like 'data:image/jpeg%' or char_length(v_image) > 200000 then
      return jsonb_build_object('ok', false, 'error', 'Image is too large. Try a smaller photo.');
    end if;
  end if;

  if exists (
    select 1
    from public.field_tools_catalog_items c
    where c.active
      and c.section = v_section
      and lower(btrim(c.name)) = lower(v_name)
      and lower(btrim(c.category)) = lower(v_category)
  ) then
    return jsonb_build_object('ok', false, 'error', 'That item is already in the catalog.');
  end if;

  if v_product_id <> '' and exists (
    select 1
    from public.field_tools_catalog_items c
    where c.active
      and c.section = v_section
      and lower(btrim(c.product_id)) = lower(v_product_id)
  ) then
    return jsonb_build_object('ok', false, 'error', 'That product ID is already used.');
  end if;

  if v_vendor <> '' then
    select v.id into v_vendor_id
    from public.field_tools_vendors v
    where v.category = 'paint'
      and v.active
      and lower(btrim(v.name)) = lower(v_vendor)
    limit 1;
    if v_vendor_id is null then
      return jsonb_build_object('ok', false, 'error', 'That vendor is not in the paint vendor list.');
    end if;
  end if;

  v_cost := null;
  if v_section = 'sundry' and p_item ? 'unit_cost' and btrim(coalesce(p_item->>'unit_cost', '')) <> '' then
    if p_item->>'unit_cost' !~ '^[0-9]+(\.[0-9]+)?$' then
      return jsonb_build_object('ok', false, 'error', 'Enter a price like 12.50, or leave it blank.');
    end if;
    v_cost := round((p_item->>'unit_cost')::numeric, 2);
  end if;

  insert into public.field_tools_catalog_items (
    section, category, name, sort_order, active, vendor_name, sheens, product_id, unit_cost, sheen_costs, image_url
  )
  values (
    v_section,
    v_category,
    v_name,
    coalesce((
      select max(c.sort_order) + 1
      from public.field_tools_catalog_items c
      where c.section = v_section
    ), 0),
    true,
    '',
    '{}'::text[],
    v_product_id,
    v_cost,
    '{}'::jsonb,
    nullif(v_image, '')
  )
  returning id into v_id;

  if v_vendor_id is not null then
    insert into public.field_tools_catalog_item_vendors (catalog_item_id, vendor_id)
    values (v_id, v_vendor_id);
  end if;

  select jsonb_build_object(
    'id', c.id,
    'section', c.section,
    'category', c.category,
    'name', c.name,
    'product_id', coalesce(c.product_id, ''),
    'unit_cost', c.unit_cost,
    'sheen_costs', coalesce(c.sheen_costs, '{}'::jsonb),
    'sheens', case
      when c.section = 'paint_product' and coalesce(cardinality(c.sheens), 0) = 0 then (
        select coalesce(jsonb_agg(s.name order by s.sort_order, s.name), '[]'::jsonb)
        from public.field_tools_catalog_items s
        where s.section = 'sheen' and s.active and btrim(s.name) <> ''
      )
      else coalesce(to_jsonb(c.sheens), '[]'::jsonb)
    end,
    'vendor_names', (
      select coalesce(jsonb_agg(v.name order by v.name), '[]'::jsonb)
      from public.field_tools_catalog_item_vendors civ
      join public.field_tools_vendors v on v.id = civ.vendor_id
      where civ.catalog_item_id = c.id
    )
  )
  into v_item
  from public.field_tools_catalog_items c
  where c.id = v_id;

  return jsonb_build_object('ok', true, 'item', v_item);
end;
$$;

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

revoke all on function public.jobflow_admin_add_material_item(jsonb) from public, anon;
grant execute on function public.jobflow_admin_add_material_item(jsonb) to authenticated;

revoke all on function public.jobflow_admin_list_sundry_photos(text, uuid, integer) from public, anon;
grant execute on function public.jobflow_admin_list_sundry_photos(text, uuid, integer) to authenticated;

notify pgrst, 'reload schema';
