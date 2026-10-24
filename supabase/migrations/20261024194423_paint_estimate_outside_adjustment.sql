-- Gallons bought outside Field Tools. Added to ordered progress without using a PO number.

alter table public.project_paint_estimates
  add column if not exists adjustment_gallons numeric(10, 2) not null default 0;

create or replace function public.job_paint_estimate_progress(p_job_number text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_clean text := split_part(trim(coalesce(p_job_number, '')), ' ', 1);
  v_items jsonb;
begin
  if v_clean = '' then
    return '[]'::jsonb;
  end if;

  with lines as (
    select
      lower(trim(coalesce(l ->> 'name', ''))) as product_key,
      coalesce(l ->> 'raw', '') as raw,
      coalesce(l ->> 'detail', '') as detail,
      coalesce(l ->> 'quantity', '') as quantity
    from public.field_tools_orders o
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(o.payload -> 'lists' -> 'paint') = 'array' then o.payload -> 'lists' -> 'paint'
        else '[]'::jsonb
      end
    ) l
    where o.order_type in ('field_request', 'pm_order', 'last_min')
      and coalesce(o.status, '') not in ('failed', 'cancelled', 'canceled')
      and split_part(trim(o.job_number), ' ', 1) = v_clean
  ),
  parsed as (
    select
      product_key,
      detail,
      public.paint_estimate_fold(substring(raw from '\(([^,)]+)')) as raw_sheen,
      coalesce(substring(quantity from '([0-9]+(?:\.[0-9]+)?)')::numeric, 0)
        * case when quantity ~* '(qt|quart)' then 0.25 else 1 end as gallons
    from lines
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'product', e.product,
        'sheen', e.sheen,
        'estimated_gallons', e.estimated_gallons,
        'notes', e.notes,
        'adjustment_gallons', coalesce(e.adjustment_gallons, 0),
        'app_ordered_gallons', coalesce((
          select sum(p.gallons)
          from parsed p
          where p.product_key = lower(trim(e.product))
            and (
              public.paint_estimate_fold(e.sheen) = ''
              or p.raw_sheen = public.paint_estimate_fold(e.sheen)
              or exists (
                select 1
                from unnest(string_to_array(p.detail, ' · ')) part
                where public.paint_estimate_fold(part) = public.paint_estimate_fold(e.sheen)
              )
            )
        ), 0),
        'ordered_gallons', coalesce((
          select sum(p.gallons)
          from parsed p
          where p.product_key = lower(trim(e.product))
            and (
              public.paint_estimate_fold(e.sheen) = ''
              or p.raw_sheen = public.paint_estimate_fold(e.sheen)
              or exists (
                select 1
                from unnest(string_to_array(p.detail, ' · ')) part
                where public.paint_estimate_fold(part) = public.paint_estimate_fold(e.sheen)
              )
            )
        ), 0) + coalesce(e.adjustment_gallons, 0)
      )
      order by lower(e.product), lower(e.sheen)
    ),
    '[]'::jsonb
  )
  into v_items
  from public.project_paint_estimates e
  where split_part(trim(e.job_number), ' ', 1) = v_clean;

  return v_items;
end;
$$;
