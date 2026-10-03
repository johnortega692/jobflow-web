-- Optional product ID on catalog items. Sundries with an ID print it under the
-- item name on the order email and PDF.

alter table public.field_tools_catalog_items
  add column if not exists product_id text not null default '';

create or replace function public.field_tools_admin_list_catalog(
  p_caller_id uuid,
  p_session_token text,
  p_section text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.field_tools_require_admin(p_caller_id, p_session_token);
  return jsonb_build_object(
    'ok', true,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'section', c.section, 'category', c.category, 'name', c.name,
        'vendor_name', coalesce(c.vendor_name, ''),
        'vendor_names', (
          select coalesce(jsonb_agg(v.name order by v.name), '[]'::jsonb)
          from public.field_tools_catalog_item_vendors civ
          join public.field_tools_vendors v on v.id = civ.vendor_id
          where civ.catalog_item_id = c.id
        ),
        'sheens', to_jsonb(coalesce(c.sheens, '{}'::text[])),
        'product_id', coalesce(c.product_id, ''),
        'sort_order', c.sort_order, 'active', c.active
      ) order by c.section, c.vendor_name, c.category, c.sort_order, c.name), '[]'::jsonb)
      from public.field_tools_catalog_items c
      where p_section is null or c.section = p_section
    )
  );
exception when sqlstate 'P0001' then
  return jsonb_build_object('ok', false, 'error', 'Admin access required');
end;
$$;

drop function if exists public.field_tools_admin_upsert_catalog_item(
  uuid, text, uuid, text, text, text, integer, boolean, text, text[], text[]
);

create or replace function public.field_tools_admin_upsert_catalog_item(
  p_caller_id uuid,
  p_session_token text,
  p_item_id uuid,
  p_section text,
  p_category text,
  p_name text,
  p_sort_order integer default 0,
  p_active boolean default true,
  p_vendor_name text default '',
  p_vendor_names text[] default null,
  p_sheens text[] default null,
  p_product_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare iid uuid;
begin
  perform public.field_tools_require_admin(p_caller_id, p_session_token);
  if p_item_id is null then
    insert into public.field_tools_catalog_items (
      section, category, name, sort_order, active, vendor_name, sheens, product_id
    )
    values (
      p_section,
      coalesce(p_category, ''),
      trim(p_name),
      coalesce(p_sort_order, 0),
      coalesce(p_active, true),
      case when p_section = 'rental_equipment' then trim(coalesce(p_vendor_name, '')) else '' end,
      coalesce(p_sheens, '{}'::text[]),
      case when p_section = 'sundry' then trim(coalesce(p_product_id, '')) else '' end
    )
    returning id into iid;
  else
    update public.field_tools_catalog_items set
      section = coalesce(p_section, section),
      category = coalesce(p_category, category),
      name = trim(p_name),
      sort_order = coalesce(p_sort_order, sort_order),
      active = coalesce(p_active, active),
      vendor_name = case
        when coalesce(p_section, section) = 'rental_equipment' then trim(coalesce(p_vendor_name, ''))
        else ''
      end,
      sheens = case when p_sheens is null then sheens else p_sheens end,
      product_id = case
        when coalesce(p_section, section) = 'sundry' then trim(coalesce(p_product_id, ''))
        else product_id
      end,
      updated_at = now()
    where id = p_item_id returning id into iid;
  end if;

  if iid is not null and p_section in ('sundry', 'paint_product') then
    if p_vendor_names is not null then
      delete from public.field_tools_catalog_item_vendors where catalog_item_id = iid;
      insert into public.field_tools_catalog_item_vendors (catalog_item_id, vendor_id)
      select distinct iid, v.id
      from public.field_tools_vendors v
      where v.category = 'paint'
        and v.name = any (p_vendor_names);
    end if;
  elsif iid is not null then
    delete from public.field_tools_catalog_item_vendors where catalog_item_id = iid;
  end if;

  return jsonb_build_object('ok', true, 'id', iid);
exception when sqlstate 'P0001' then
  return jsonb_build_object('ok', false, 'error', 'Admin access required');
end;
$$;

grant execute on function public.field_tools_admin_upsert_catalog_item(
  uuid, text, uuid, text, text, text, integer, boolean, text, text[], text[], text
) to anon, authenticated;

-- Append sundry product IDs to the order catalog payload.
do $patch$
declare
  src text;
  needle text := $n$    'haul_off_note', (
      SELECT coalesce((SELECT c.name FROM public.field_tools_catalog_items c
        WHERE c.active AND c.section = 'haul_off_note' ORDER BY c.sort_order LIMIT 1), '')
    )
  );$n$;
  extra text := $n$    'haul_off_note', (
      SELECT coalesce((SELECT c.name FROM public.field_tools_catalog_items c
        WHERE c.active AND c.section = 'haul_off_note' ORDER BY c.sort_order LIMIT 1), '')
    ),
    'sundry_product_ids', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'category', c.category,
        'name', c.name,
        'product_id', trim(c.product_id)
      ) ORDER BY c.category, c.sort_order, c.name), '[]'::jsonb)
      FROM public.field_tools_catalog_items c
      WHERE c.active AND c.section = 'sundry' AND trim(coalesce(c.product_id, '')) <> ''
    )
  );$n$;
begin
  select pg_get_functiondef('public.field_tools_get_order_catalog(uuid,text)'::regprocedure) into src;
  if position('sundry_product_ids' in src) > 0 then
    return;
  end if;
  if position(needle in src) = 0 then
    raise exception 'field_tools_get_order_catalog is missing the haul_off_note block';
  end if;
  execute replace(src, needle, extra);
end;
$patch$;

notify pgrst, 'reload schema';
