-- Alternate names for one catalog product, such as a sheen or tint-base name.

alter table public.field_tools_catalog_items
  add column if not exists akas text[] not null default '{}';

create or replace function public.jobflow_admin_list_material_prices()
returns jsonb
language plpgsql
stable
security definer
set search_path to public
as $$
declare
  v_items jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.app_role = 'admin'
  ) then
    return jsonb_build_object('ok', false, 'error', 'Admin access required');
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.section, x.category, x.name), '[]'::jsonb)
  into v_items
  from (
    select
      c.id,
      c.section,
      c.category,
      c.name,
      coalesce(c.product_id, '') as product_id,
      c.unit_cost,
      coalesce(c.sheen_costs, '{}'::jsonb) as sheen_costs,
      coalesce(c.akas, '{}'::text[]) as akas,
      case
        when c.section = 'paint_product' and coalesce(cardinality(c.sheens), 0) = 0 then (
          select coalesce(jsonb_agg(s.name order by s.sort_order, s.name), '[]'::jsonb)
          from public.field_tools_catalog_items s
          where s.section = 'sheen' and s.active and btrim(s.name) <> ''
        )
        else coalesce(to_jsonb(c.sheens), '[]'::jsonb)
      end as sheens,
      (
        select coalesce(jsonb_agg(v.name order by v.name), '[]'::jsonb)
        from public.field_tools_catalog_item_vendors civ
        join public.field_tools_vendors v on v.id = civ.vendor_id
        where civ.catalog_item_id = c.id
      ) as vendor_names
    from public.field_tools_catalog_items c
    where c.active
      and c.section in ('sundry', 'paint_product')
  ) x;

  return jsonb_build_object('ok', true, 'items', v_items);
end;
$$;

create or replace function public.jobflow_admin_set_material_akas(p_id uuid, p_akas jsonb)
returns jsonb
language plpgsql
security definer
set search_path to public
as $$
declare
  v_section text;
  v_name text;
  v_raw text;
  v_aka text;
  v_key text;
  v_akas text[] := '{}';
  v_seen text[] := '{}';
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.app_role = 'admin'
  ) then
    return jsonb_build_object('ok', false, 'error', 'Admin access required');
  end if;

  select c.section, c.name into v_section, v_name
  from public.field_tools_catalog_items c
  where c.id = p_id and c.active and c.section in ('sundry', 'paint_product');
  if v_section is null then
    return jsonb_build_object('ok', false, 'error', 'That product was not found.');
  end if;
  if jsonb_typeof(coalesce(p_akas, '[]'::jsonb)) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'error', 'Enter one AKA per line.');
  end if;
  if jsonb_array_length(p_akas) > 24 then
    return jsonb_build_object('ok', false, 'error', 'A product can have up to 24 AKAs.');
  end if;

  for v_raw in select value from jsonb_array_elements_text(p_akas)
  loop
    v_aka := btrim(v_raw);
    if v_aka = '' then
      continue;
    end if;
    if char_length(v_aka) > 120 then
      return jsonb_build_object('ok', false, 'error', 'An AKA has to be 120 characters or less.');
    end if;
    v_key := lower(v_aka);
    if v_key = lower(btrim(v_name)) or v_key = any (v_seen) then
      continue;
    end if;
    if exists (
      select 1
      from public.field_tools_catalog_items c
      where c.active
        and c.section = v_section
        and c.id <> p_id
        and (
          lower(btrim(c.name)) = v_key
          or exists (
            select 1 from unnest(coalesce(c.akas, '{}'::text[])) aka
            where lower(btrim(aka)) = v_key
          )
        )
    ) then
      return jsonb_build_object('ok', false, 'error', v_aka || ' is already used by another product.');
    end if;
    v_seen := v_seen || v_key;
    v_akas := v_akas || v_aka;
  end loop;

  update public.field_tools_catalog_items
  set akas = v_akas, updated_at = now()
  where id = p_id;

  return jsonb_build_object('ok', true, 'akas', to_jsonb(v_akas));
end;
$$;

revoke all on function public.jobflow_admin_list_material_prices() from public, anon;
grant execute on function public.jobflow_admin_list_material_prices() to authenticated;
revoke all on function public.jobflow_admin_set_material_akas(uuid, jsonb) from public, anon;
grant execute on function public.jobflow_admin_set_material_akas(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
