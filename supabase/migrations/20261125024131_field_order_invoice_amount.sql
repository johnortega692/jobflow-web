-- Field-request invoice amount replaces that order's catalog total on the material budget.
-- The placed total stays the catalog price (with sales tax) so the original order total remains visible.

create or replace function public.field_tools_order_invoice_amount(p_payload jsonb)
returns numeric
language sql
immutable
as $$
  select case
    when cleaned ~ '^[0-9]+(\.[0-9]+)?$' then round(cleaned::numeric, 2)
    else null
  end
  from (
    select regexp_replace(coalesce(p_payload ->> 'invoiceAmount', ''), '[^0-9.]', '', 'g') as cleaned
  ) parsed
  where cleaned <> ''
$$;

create or replace function public.field_tools_field_order_placed(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to public
as $$
  with ord as (
    select *
    from public.field_tools_orders
    where id = p_order_id
  ),
  sundry_lines as (
    select
      case
        when jsonb_typeof(item) = 'object' then nullif(btrim(item ->> 'name'), '')
        when jsonb_typeof(item) = 'string' then nullif(btrim((regexp_match(item #>> '{}', '^[0-9]+(?:\.[0-9]+)?\s*[x×]\s+(.+)$', 'i'))[1]), '')
        else null
      end as item_name,
      case
        when jsonb_typeof(item) = 'object' then public.field_tools_sundry_qty(item ->> 'quantity')
        when jsonb_typeof(item) = 'string' then public.field_tools_sundry_qty((regexp_match(item #>> '{}', '^([0-9]+(?:\.[0-9]+)?)'))[1])
        else null
      end as qty,
      case
        when jsonb_typeof(item) = 'string' then nullif(btrim(item #>> '{}'), '')
        when jsonb_typeof(item) = 'object' then nullif(btrim(coalesce(item ->> 'name', item ->> 'raw', '')), '')
        else null
      end as raw_line
    from ord
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(ord.materials) = 'array' then ord.materials else '[]'::jsonb end
    ) item
  ),
  sundry_costs as (
    select
      raw_line,
      case
        when item_name is null or qty is null or qty <= 0 then null
        else public.field_tools_catalog_unit_cost('sundry', item_name) * qty
      end as cost
    from sundry_lines
    where raw_line is not null
  ),
  paint_lines as (
    select
      case
        when jsonb_typeof(elem) = 'object' then nullif(btrim(elem ->> 'name'), '')
        when jsonb_typeof(elem) = 'string' then nullif(btrim(regexp_replace(
          regexp_replace(elem #>> '{}', '^[0-9]+(?:\.[0-9]+)?\s*(?:qt|qts|quart|quarts|gal|gals)?\s+', '', 'i'),
          '\s*\(.*$',
          ''
        )), '')
        else null
      end as item_name,
      case
        when jsonb_typeof(elem) = 'object' then coalesce(
          nullif(btrim(elem ->> 'sheen'), ''),
          nullif(btrim(split_part(coalesce(elem ->> 'detail', ''), ' · ', 1)), '')
        )
        when jsonb_typeof(elem) = 'string' then btrim((regexp_match(elem #>> '{}', '\(([^,)]+)'))[1])
        else null
      end as sheen,
      case
        when jsonb_typeof(elem) = 'object' then public.field_tools_paint_gallons(elem ->> 'quantity')
        when jsonb_typeof(elem) = 'string' then public.field_tools_paint_gallons(elem #>> '{}')
        else null
      end as gallons,
      case
        when jsonb_typeof(elem) = 'string' then nullif(btrim(elem #>> '{}'), '')
        when jsonb_typeof(elem) = 'object' then nullif(btrim(coalesce(elem ->> 'name', elem ->> 'raw', '')), '')
        else null
      end as raw_line
    from ord
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(ord.paint) = 'array' then ord.paint else '[]'::jsonb end
    ) elem
  ),
  paint_costs as (
    select
      raw_line,
      case
        when item_name is null or gallons is null or gallons <= 0 then null
        else public.field_tools_paint_sheen_cost(item_name, sheen) * gallons
      end as cost
    from paint_lines
    where raw_line is not null
  ),
  priced as (
    select cost, raw_line from sundry_costs
    union all
    select cost, raw_line from paint_costs
  )
  select jsonb_build_object(
    'placed', round(coalesce((select sum(cost) filter (where cost is not null) from priced), 0) * public.field_tools_material_tax_multiplier(), 2),
    'unpriced', coalesce((select count(*) filter (where cost is null) from priced), 0)
  )
$$;

create or replace function public.field_tools_material_ordered_amount(p_job_number text)
returns numeric
language sql
stable
security definer
set search_path to public
as $$
  with sundry_costs as (
    select public.field_tools_catalog_unit_cost('sundry', item->>'name')
      * public.field_tools_sundry_qty(item->>'quantity') as cost
    from public.field_tools_orders o
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(o.materials) = 'array' then o.materials else '[]'::jsonb end
    ) item
    where btrim(o.job_number) = btrim(coalesce(p_job_number, ''))
      and coalesce(o.status, '') <> 'cancelled'
      and jsonb_typeof(item) = 'object'
      and public.field_tools_order_invoice_amount(o.payload) is null
  ),
  paint_rows as (
    select
      case
        when jsonb_typeof(elem) = 'object' then elem->>'name'
        when jsonb_typeof(elem) = 'string' then btrim(regexp_replace(
          regexp_replace(elem #>> '{}', '^[0-9]+(?:\.[0-9]+)?\s*(?:qt|qts|quart|quarts|gal|gals)?\s+', '', 'i'),
          '\s*\(.*$',
          ''
        ))
        else null
      end as name,
      case
        when jsonb_typeof(elem) = 'object' then coalesce(
          nullif(btrim(elem->>'sheen'), ''),
          nullif(btrim(split_part(coalesce(elem->>'detail', ''), ' · ', 1)), '')
        )
        when jsonb_typeof(elem) = 'string' then btrim((regexp_match(elem #>> '{}', '\(([^,)]+)'))[1])
        else null
      end as sheen,
      case
        when jsonb_typeof(elem) = 'object' then public.field_tools_paint_gallons(elem->>'quantity')
        when jsonb_typeof(elem) = 'string' then public.field_tools_paint_gallons(elem #>> '{}')
        else null
      end as gallons
    from public.field_tools_orders o
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(o.paint) = 'array' then o.paint else '[]'::jsonb end
    ) elem
    where btrim(o.job_number) = btrim(coalesce(p_job_number, ''))
      and coalesce(o.status, '') <> 'cancelled'
      and public.field_tools_order_invoice_amount(o.payload) is null
      and not (
        o.order_type = 'last_min'
        and coalesce((
          select case
            when cleaned ~ '^[0-9]+(\.[0-9]+)?$' then round(cleaned::numeric, 2)
            else null
          end
          from (
            select regexp_replace(coalesce(o.payload ->> 'amount', ''), '[^0-9.]', '', 'g') as cleaned
          ) parsed
        ), 0) > 0
      )
  ),
  paint_costs as (
    select public.field_tools_paint_sheen_cost(name, sheen) * gallons as cost
    from paint_rows
  ),
  last_min_amounts as (
    select case
      when cleaned ~ '^[0-9]+(\.[0-9]+)?$' then round(cleaned::numeric, 2)
      else null
    end as cost
    from public.field_tools_orders o
    cross join lateral (
      select regexp_replace(coalesce(o.payload ->> 'amount', ''), '[^0-9.]', '', 'g') as cleaned
    ) parsed
    where btrim(o.job_number) = btrim(coalesce(p_job_number, ''))
      and o.order_type = 'last_min'
      and coalesce(o.status, '') <> 'cancelled'
      and cleaned <> ''
  ),
  invoice_amounts as (
    select public.field_tools_order_invoice_amount(o.payload) as cost
    from public.field_tools_orders o
    where btrim(o.job_number) = btrim(coalesce(p_job_number, ''))
      and o.order_type is distinct from 'last_min'
      and coalesce(o.status, '') <> 'cancelled'
      and public.field_tools_order_invoice_amount(o.payload) is not null
  )
  select round(coalesce(sum(cost), 0) * public.field_tools_material_tax_multiplier(), 2)
    + coalesce((select sum(cost) from last_min_amounts where cost is not null and cost > 0), 0)
    + coalesce((select sum(cost) from invoice_amounts where cost is not null and cost > 0), 0)
  from (
    select cost from sundry_costs
    union all
    select cost from paint_costs
  ) priced
  where cost is not null
$$;

create or replace function public.jobflow_material_order_spend(p_job_number text)
returns jsonb
language plpgsql
security definer
set search_path to public
as $$
declare
  v_budget numeric;
  v_ordered numeric;
  v_tax numeric;
  v_months jsonb;
begin
  if auth.uid() is null or not public.is_approved_user() then
    return jsonb_build_object('ok', false, 'error', 'Sign in required');
  end if;

  v_budget := public.field_tools_material_budget_amount(p_job_number);
  v_ordered := public.field_tools_material_ordered_amount(p_job_number);
  v_tax := coalesce((select s.tax_percent from public.field_tools_material_report_settings s where s.id = 1), 10.25);

  with sundry_costs as (
    select
      to_char(timezone('America/Los_Angeles', o.created_at), 'YYYY-MM') as month_key,
      public.field_tools_catalog_unit_cost('sundry', item->>'name')
        * public.field_tools_sundry_qty(item->>'quantity') as cost
    from public.field_tools_orders o
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(o.materials) = 'array' then o.materials else '[]'::jsonb end
    ) item
    where btrim(o.job_number) = btrim(coalesce(p_job_number, ''))
      and coalesce(o.status, '') <> 'cancelled'
      and jsonb_typeof(item) = 'object'
      and public.field_tools_order_invoice_amount(o.payload) is null
  ),
  paint_rows as (
    select
      to_char(timezone('America/Los_Angeles', o.created_at), 'YYYY-MM') as month_key,
      case
        when jsonb_typeof(elem) = 'object' then elem->>'name'
        when jsonb_typeof(elem) = 'string' then btrim(regexp_replace(
          regexp_replace(elem #>> '{}', '^[0-9]+(?:\.[0-9]+)?\s*(?:qt|qts|quart|quarts|gal|gals)?\s+', '', 'i'),
          '\s*\(.*$',
          ''
        ))
        else null
      end as name,
      case
        when jsonb_typeof(elem) = 'object' then coalesce(
          nullif(btrim(elem->>'sheen'), ''),
          nullif(btrim(split_part(coalesce(elem->>'detail', ''), ' · ', 1)), '')
        )
        when jsonb_typeof(elem) = 'string' then btrim((regexp_match(elem #>> '{}', '\(([^,)]+)'))[1])
        else null
      end as sheen,
      case
        when jsonb_typeof(elem) = 'object' then public.field_tools_paint_gallons(elem->>'quantity')
        when jsonb_typeof(elem) = 'string' then public.field_tools_paint_gallons(elem #>> '{}')
        else null
      end as gallons
    from public.field_tools_orders o
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(o.paint) = 'array' then o.paint else '[]'::jsonb end
    ) elem
    where btrim(o.job_number) = btrim(coalesce(p_job_number, ''))
      and coalesce(o.status, '') <> 'cancelled'
      and public.field_tools_order_invoice_amount(o.payload) is null
      and not (
        o.order_type = 'last_min'
        and coalesce((
          select case
            when cleaned ~ '^[0-9]+(\.[0-9]+)?$' then round(cleaned::numeric, 2)
            else null
          end
          from (
            select regexp_replace(coalesce(o.payload ->> 'amount', ''), '[^0-9.]', '', 'g') as cleaned
          ) parsed
        ), 0) > 0
      )
  ),
  paint_costs as (
    select month_key, public.field_tools_paint_sheen_cost(name, sheen) * gallons as cost
    from paint_rows
  ),
  catalog as (
    select month_key, sum(cost) as pretax
    from (
      select month_key, cost from sundry_costs
      union all
      select month_key, cost from paint_costs
    ) lines
    where cost is not null and month_key is not null
    group by month_key
  ),
  last_min_amounts as (
    select
      to_char(timezone('America/Los_Angeles', o.created_at), 'YYYY-MM') as month_key,
      case
        when cleaned ~ '^[0-9]+(\.[0-9]+)?$' then round(cleaned::numeric, 2)
        else null
      end as cost
    from public.field_tools_orders o
    cross join lateral (
      select regexp_replace(coalesce(o.payload ->> 'amount', ''), '[^0-9.]', '', 'g') as cleaned
    ) parsed
    where btrim(o.job_number) = btrim(coalesce(p_job_number, ''))
      and o.order_type = 'last_min'
      and coalesce(o.status, '') <> 'cancelled'
      and cleaned <> ''
  ),
  last_min as (
    select month_key, sum(cost) as amount
    from last_min_amounts
    where cost is not null and cost > 0 and month_key is not null
    group by month_key
  ),
  invoice_amounts as (
    select
      to_char(timezone('America/Los_Angeles', o.created_at), 'YYYY-MM') as month_key,
      public.field_tools_order_invoice_amount(o.payload) as cost
    from public.field_tools_orders o
    where btrim(o.job_number) = btrim(coalesce(p_job_number, ''))
      and o.order_type is distinct from 'last_min'
      and coalesce(o.status, '') <> 'cancelled'
      and public.field_tools_order_invoice_amount(o.payload) is not null
  ),
  invoice as (
    select month_key, sum(cost) as amount
    from invoice_amounts
    where cost is not null and cost > 0 and month_key is not null
    group by month_key
  ),
  combined as (
    select
      coalesce(base.month_key, i.month_key) as month_key,
      coalesce(base.amount, 0) + coalesce(i.amount, 0) as amount
    from (
      select
        coalesce(c.month_key, l.month_key) as month_key,
        round(coalesce(c.pretax, 0) * public.field_tools_material_tax_multiplier(), 2)
          + coalesce(l.amount, 0) as amount
      from catalog c
      full outer join last_min l on l.month_key = c.month_key
    ) base
    full outer join invoice i on i.month_key = base.month_key
  ),
  ranked as (
    select
      month_key,
      amount,
      row_number() over (order by month_key desc) as rn,
      sum(amount) over () as month_sum
    from combined
    where amount <> 0
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'month', month_key,
        'amount', case
          when rn = 1 then round(amount + (v_ordered - month_sum), 2)
          else amount
        end
      )
      order by month_key
    ),
    '[]'::jsonb
  )
  into v_months
  from ranked;

  return jsonb_build_object(
    'ok', true,
    'budget', v_budget,
    'ordered', v_ordered,
    'tax_percent', v_tax,
    'months', coalesce(v_months, '[]'::jsonb)
  );
end;
$$;

create or replace function public.jobflow_field_order_totals(p_job_number text)
returns jsonb
language plpgsql
stable
security definer
set search_path to public
as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null or not public.is_approved_user(auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'Sign in required');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id', o.id,
    'placed', (placed.doc ->> 'placed')::numeric,
    'unpriced', (placed.doc ->> 'unpriced')::integer,
    'invoice', public.field_tools_order_invoice_amount(o.payload)
  )), '[]'::jsonb)
  into v_rows
  from public.field_tools_orders o
  cross join lateral (
    select public.field_tools_field_order_placed(o.id) as doc
  ) placed
  where btrim(o.job_number) = btrim(coalesce(p_job_number, ''))
    and o.order_type in ('field_request', 'pm_order')
    and coalesce(o.status, '') <> 'cancelled';

  return jsonb_build_object('ok', true, 'orders', v_rows);
end;
$$;

create or replace function public.jobflow_set_field_order_invoice(p_order_id uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path to public
as $$
declare
  v_order public.field_tools_orders%rowtype;
  v_amount numeric;
  v_text text;
begin
  if auth.uid() is null or not public.is_approved_user(auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'Sign in required');
  end if;
  if not public.is_app_admin(auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'Only an admin can change an order invoice.');
  end if;
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'error', 'Order id required');
  end if;
  if p_amount is null or p_amount < 0 or p_amount > 999999.99 then
    return jsonb_build_object('ok', false, 'error', 'Enter the invoice amount.');
  end if;

  select * into v_order
  from public.field_tools_orders
  where id = p_order_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Order not found');
  end if;
  if v_order.order_type not in ('field_request', 'pm_order') then
    return jsonb_build_object('ok', false, 'error', 'The invoice can be set on a field request or PM order.');
  end if;
  if coalesce(v_order.status, '') in ('failed', 'cancelled', 'canceled') then
    return jsonb_build_object('ok', false, 'error', 'This order is cancelled.');
  end if;

  v_amount := round(p_amount, 2);
  v_text := to_char(v_amount, 'FM999999990.00');

  update public.field_tools_orders
  set payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{invoiceAmount}', to_jsonb(v_text), true)
  where id = p_order_id;

  return jsonb_build_object('ok', true, 'amount', v_text);
end;
$$;

revoke all on function public.field_tools_order_invoice_amount(jsonb) from public, anon, authenticated;
revoke all on function public.field_tools_field_order_placed(uuid) from public, anon, authenticated;
revoke all on function public.jobflow_field_order_totals(text) from public, anon;
revoke all on function public.jobflow_set_field_order_invoice(uuid, numeric) from public, anon;
grant execute on function public.jobflow_field_order_totals(text) to authenticated;
grant execute on function public.jobflow_set_field_order_invoice(uuid, numeric) to authenticated;
