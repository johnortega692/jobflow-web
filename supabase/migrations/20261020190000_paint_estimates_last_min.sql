-- Last-min receipts can carry paint lines. Those gallons count toward estimates.
-- Receipts with no paint lines are reported separately so ordered totals are not read as complete.

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
        ), 0)
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

-- Last-min receipts on a job with no paint lines: how many, and their dollar total.
create or replace function public.job_last_min_uncounted(p_job_number text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'count', count(*),
    'amount', coalesce(sum(
      nullif(regexp_replace(coalesce(o.payload ->> 'amount', ''), '[^0-9.]', '', 'g'), '')::numeric
    ), 0)
  )
  from public.field_tools_orders o
  where o.order_type = 'last_min'
    and coalesce(o.status, '') not in ('failed', 'cancelled', 'canceled')
    and split_part(trim(o.job_number), ' ', 1) = split_part(trim(coalesce(p_job_number, '')), ' ', 1)
    and split_part(trim(coalesce(p_job_number, '')), ' ', 1) <> ''
    and (
      jsonb_typeof(o.payload -> 'lists' -> 'paint') is distinct from 'array'
      or jsonb_array_length(o.payload -> 'lists' -> 'paint') = 0
    );
$$;

revoke all on function public.job_last_min_uncounted(text) from public, anon;
grant execute on function public.job_last_min_uncounted(text) to authenticated;
