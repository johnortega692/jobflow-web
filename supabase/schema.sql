-- JobFlow Web — run once in Supabase SQL Editor (Dashboard → SQL → New query)

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  job_number text not null,
  job_name text not null default '',
  job_address text default '',
  job_address2 text default '',
  contractor text default '',
  architect text default '',
  owner text default '',
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create index if not exists projects_job_number_idx on projects (job_number);
create index if not exists projects_updated_at_idx on projects (updated_at desc);

create table if not exists rfis (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  rfi_number text not null default '001',
  subject text not null default '',
  status text not null default 'draft',
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rfis_project_id_idx on rfis (project_id);
create index if not exists rfis_updated_at_idx on rfis (updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_updated_at on projects;
create trigger projects_updated_at
  before update on projects
  for each row execute function public.set_updated_at();

drop trigger if exists rfis_updated_at on rfis;
create trigger rfis_updated_at
  before update on rfis
  for each row execute function public.set_updated_at();

alter table projects enable row level security;
alter table rfis enable row level security;

-- Starter policies: any signed-in user can access (tighten per org later)
drop policy if exists "projects_select" on projects;
create policy "projects_select" on projects for select to authenticated using (true);

drop policy if exists "projects_insert" on projects;
create policy "projects_insert" on projects for insert to authenticated with check (true);

drop policy if exists "projects_update" on projects;
create policy "projects_update" on projects for update to authenticated using (true);

drop policy if exists "projects_delete" on projects;
create policy "projects_delete" on projects for delete to authenticated using (true);

-- Field view (/field): supers without accounts (anon role)
drop policy if exists "projects_select_anon" on projects;
create policy "projects_select_anon" on projects for select to anon using (true);
drop policy if exists "projects_update_anon" on projects;
create policy "projects_update_anon" on projects for update to anon using (true) with check (true);

create table if not exists project_activity (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  user_name text not null default '',
  action text not null,
  summary text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists project_activity_project_id_created_at_idx
  on project_activity (project_id, created_at desc);

alter table project_activity enable row level security;

drop policy if exists "project_activity_select" on project_activity;
create policy "project_activity_select" on project_activity for select to authenticated using (true);

drop policy if exists "project_activity_insert" on project_activity;
create policy "project_activity_insert" on project_activity for insert to authenticated with check (true);

drop policy if exists "project_activity_insert_anon" on project_activity;
create policy "project_activity_insert_anon" on project_activity for insert to anon with check (true);

drop policy if exists "rfis_select" on rfis;
create policy "rfis_select" on rfis for select to authenticated using (true);

drop policy if exists "rfis_insert" on rfis;
create policy "rfis_insert" on rfis for insert to authenticated with check (true);

drop policy if exists "rfis_update" on rfis;
create policy "rfis_update" on rfis for update to authenticated using (true);

drop policy if exists "rfis_delete" on rfis;
create policy "rfis_delete" on rfis for delete to authenticated using (true);

-- Submittal log (also in supabase/migrations/002_submittals.sql)
create table if not exists submittals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  line_number text not null default '01',
  description text not null default '',
  spec_section text not null default '',
  submittal_type text not null default '',
  scope text not null default '',
  status text not null default 'Draft',
  result_code text not null default '',
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists submittals_project_id_idx on submittals (project_id);

drop trigger if exists submittals_updated_at on submittals;
create trigger submittals_updated_at
  before update on submittals for each row execute function public.set_updated_at();

alter table submittals enable row level security;

drop policy if exists "submittals_select" on submittals;
create policy "submittals_select" on submittals for select to authenticated using (true);
drop policy if exists "submittals_insert" on submittals;
create policy "submittals_insert" on submittals for insert to authenticated with check (true);
drop policy if exists "submittals_update" on submittals;
create policy "submittals_update" on submittals for update to authenticated using (true);
drop policy if exists "submittals_delete" on submittals;
create policy "submittals_delete" on submittals for delete to authenticated using (true);

-- Work orders / EWO (also in supabase/migrations/005_work_orders.sql)
create table if not exists work_orders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
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

create index if not exists work_orders_project_id_idx on work_orders (project_id);

drop trigger if exists work_orders_updated_at on work_orders;
create trigger work_orders_updated_at
  before update on work_orders for each row execute function public.set_updated_at();

alter table work_orders enable row level security;

drop policy if exists "work_orders_select" on work_orders;
create policy "work_orders_select" on work_orders for select to authenticated using (true);
drop policy if exists "work_orders_insert" on work_orders;
create policy "work_orders_insert" on work_orders for insert to authenticated with check (true);
drop policy if exists "work_orders_update" on work_orders;
create policy "work_orders_update" on work_orders for update to authenticated using (true);
drop policy if exists "work_orders_delete" on work_orders;
create policy "work_orders_delete" on work_orders for delete to authenticated using (true);

insert into storage.buckets (id, name, public)
values ('work-orders', 'work-orders', false)
on conflict (id) do nothing;

drop policy if exists "work_orders_storage_authenticated_all" on storage.objects;
create policy "work_orders_storage_authenticated_all" on storage.objects
  for all to authenticated
  using (bucket_id = 'work-orders')
  with check (bucket_id = 'work-orders');
