-- Estimated paint quantities per job, one row per product and sheen.
-- Ordered gallons come from Field Tools field and PM orders on the same job.

create table if not exists public.project_paint_estimates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  job_number text not null default '',
  product text not null,
  sheen text not null default '',
  estimated_gallons numeric(10, 2) not null default 0 check (estimated_gallons >= 0),
  notes text not null default '',
  updated_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists project_paint_estimates_product_sheen_key
  on public.project_paint_estimates (project_id, lower(trim(product)), lower(trim(sheen)));

create index if not exists project_paint_estimates_job_number_idx
  on public.project_paint_estimates (split_part(trim(job_number), ' ', 1));

alter table public.project_paint_estimates enable row level security;

drop policy if exists project_paint_estimates_auth_all on public.project_paint_estimates;
create policy project_paint_estimates_auth_all
  on public.project_paint_estimates
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists project_paint_estimates_deny_anon on public.project_paint_estimates;
create policy project_paint_estimates_deny_anon
  on public.project_paint_estimates
  for all
  to anon
  using (false);

-- Case, spaces, and punctuation do not matter: "Semi-Gloss" = "semi gloss".
create or replace function public.paint_estimate_fold(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9]', '', 'g');
$$;

-- Estimates for a job with gallons already ordered.
-- Counts paint lines on field_request and pm_order orders that did not fail.
-- A line matches on product name and sheen. An estimate with no sheen takes every sheen.
-- Quarts count as 0.25 gal.
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
    where o.order_type in ('field_request', 'pm_order')
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

revoke all on function public.job_paint_estimate_progress(text) from public, anon;
grant execute on function public.job_paint_estimate_progress(text) to authenticated;
