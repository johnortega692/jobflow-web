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
  updated_at timestamptz not null default now()
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

drop policy if exists "rfis_select" on rfis;
create policy "rfis_select" on rfis for select to authenticated using (true);

drop policy if exists "rfis_insert" on rfis;
create policy "rfis_insert" on rfis for insert to authenticated with check (true);

drop policy if exists "rfis_update" on rfis;
create policy "rfis_update" on rfis for update to authenticated using (true);

drop policy if exists "rfis_delete" on rfis;
create policy "rfis_delete" on rfis for delete to authenticated using (true);
