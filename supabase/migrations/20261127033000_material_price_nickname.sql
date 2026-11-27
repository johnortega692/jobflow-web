-- Invoice Check can match a Field Tools nickname as well as the catalog name.

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
      coalesce(c.nickname, '') as nickname,
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

revoke all on function public.jobflow_admin_list_material_prices() from public, anon;
grant execute on function public.jobflow_admin_list_material_prices() to authenticated;
