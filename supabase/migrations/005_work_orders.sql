-- Extra Work Orders (EWO) — Work Order Manager (web Phase 1)

create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  ewo_number text not null default '001',
  ewo_date text not null default '',
  total_amount numeric not null default 0,
  material_cost numeric not null default 0,
  labor_cost numeric not null default 0,
  delivered boolean not null default false,
  status text not null default 'draft',
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists work_orders_project_id_idx on public.work_orders (project_id);
create index if not exists work_orders_ewo_number_idx on public.work_orders (project_id, ewo_number);
create index if not exists work_orders_updated_at_idx on public.work_orders (updated_at desc);

drop trigger if exists work_orders_updated_at on public.work_orders;
create trigger work_orders_updated_at
  before update on public.work_orders
  for each row execute function public.set_updated_at();

alter table public.work_orders enable row level security;

drop policy if exists "work_orders_select" on public.work_orders;
create policy "work_orders_select" on public.work_orders
  for select to authenticated using (true);

drop policy if exists "work_orders_insert" on public.work_orders;
create policy "work_orders_insert" on public.work_orders
  for insert to authenticated with check (true);

drop policy if exists "work_orders_update" on public.work_orders;
create policy "work_orders_update" on public.work_orders
  for update to authenticated using (true);

drop policy if exists "work_orders_delete" on public.work_orders;
create policy "work_orders_delete" on public.work_orders
  for delete to authenticated using (true);
