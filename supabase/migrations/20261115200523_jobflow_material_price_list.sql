-- JobFlow admins update Field Tools paint and sundry prices from one list.

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

create or replace function public.jobflow_admin_save_material_prices(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to public
as $$
declare
  line jsonb;
  v_id uuid;
  v_section text;
  v_cost numeric;
  v_costs jsonb;
  v_clean jsonb;
  v_updated integer := 0;
  pair record;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.app_role = 'admin'
  ) then
    return jsonb_build_object('ok', false, 'error', 'Admin access required');
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'error', 'No prices to save.');
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'Save 2,000 prices or fewer at a time.');
  end if;

  for line in select value from jsonb_array_elements(p_rows)
  loop
    begin
      v_id := (line->>'id')::uuid;
    exception when invalid_text_representation then
      return jsonb_build_object('ok', false, 'error', 'A price row was not a catalog item.');
    end;
    select c.section into v_section
    from public.field_tools_catalog_items c
    where c.id = v_id and c.active and c.section in ('sundry', 'paint_product');
    if v_section is null then
      return jsonb_build_object('ok', false, 'error', 'A catalog item was not found.');
    end if;

    if v_section = 'sundry' then
      if line->>'unit_cost' is null or btrim(line->>'unit_cost') = '' or line->>'unit_cost' = 'null' then
        v_cost := null;
      elsif line->>'unit_cost' !~ '^[0-9]+(\.[0-9]+)?$' then
        return jsonb_build_object('ok', false, 'error', 'Enter a price like 12.50, or leave it blank.');
      else
        v_cost := round((line->>'unit_cost')::numeric, 2);
      end if;
      update public.field_tools_catalog_items
      set unit_cost = v_cost, updated_at = now()
      where id = v_id;
    else
      v_costs := line->'sheen_costs';
      if jsonb_typeof(v_costs) is distinct from 'object' then
        return jsonb_build_object('ok', false, 'error', 'Paint prices have to be entered by sheen.');
      end if;
      v_clean := '{}'::jsonb;
      for pair in select key, value from jsonb_each_text(v_costs)
      loop
        if btrim(pair.key) = '' or btrim(pair.value) = '' then
          continue;
        end if;
        if btrim(pair.value) !~ '^[0-9]+(\.[0-9]+)?$' then
          return jsonb_build_object('ok', false, 'error', 'Enter a gallon price like 12.50, or leave it blank.');
        end if;
        v_clean := v_clean || jsonb_build_object(btrim(pair.key), round(btrim(pair.value)::numeric, 2));
      end loop;
      update public.field_tools_catalog_items
      set sheen_costs = v_clean, updated_at = now()
      where id = v_id;
    end if;
    v_updated := v_updated + 1;
  end loop;

  return jsonb_build_object('ok', true, 'updated', v_updated);
end;
$$;

revoke all on function public.jobflow_admin_list_material_prices() from public, anon;
revoke all on function public.jobflow_admin_save_material_prices(jsonb) from public, anon;
grant execute on function public.jobflow_admin_list_material_prices() to authenticated;
grant execute on function public.jobflow_admin_save_material_prices(jsonb) to authenticated;

notify pgrst, 'reload schema';
