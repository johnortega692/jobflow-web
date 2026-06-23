-- Manpower Cal — shared Supabase with JobFlow (PIN auth + RPC API)
-- Apply in Supabase SQL Editor or: supabase db push

create extension if not exists pgcrypto;

create schema if not exists manpower_api;
revoke all on schema manpower_api from public;
grant usage on schema manpower_api to anon, authenticated;

create table if not exists public.manpower_supers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  pin_hash text not null,
  supervisor_label text check (supervisor_label in ('Robert', 'John') or supervisor_label is null),
  is_admin boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.manpower_sessions (
  token uuid primary key default gen_random_uuid(),
  super_id uuid not null references public.manpower_supers(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists manpower_sessions_expires_idx on public.manpower_sessions (expires_at);

create table if not exists public.manpower_employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null default 'normal'
    check (role in ('foreman', 'leadman', 'apprentice', 'wallcovering', 'normal')),
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.manpower_weeks (
  id uuid primary key default gen_random_uuid(),
  week_label text not null unique,
  week_start date not null,
  created_at timestamptz not null default now()
);

create table if not exists public.manpower_jobs (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references public.manpower_weeks(id) on delete cascade,
  name text not null,
  project_id uuid references public.projects(id) on delete set null,
  supervisor_label text check (supervisor_label in ('Robert', 'John') or supervisor_label is null),
  row_color text not null default '#ffffff',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists manpower_jobs_week_id_idx on public.manpower_jobs (week_id);

create table if not exists public.manpower_assignments (
  week_id uuid not null references public.manpower_weeks(id) on delete cascade,
  employee_id uuid not null references public.manpower_employees(id) on delete cascade,
  day_key text not null check (day_key in ('mon','tue','wed','thu','fri','sat','sun')),
  cell_value text not null default '',
  updated_at timestamptz not null default now(),
  primary key (week_id, employee_id, day_key)
);

create table if not exists public.manpower_transfer_options (
  id uuid primary key default gen_random_uuid(),
  am_job text not null,
  pm_job text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.manpower_hours_jobs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null unique,
  project_id uuid references public.projects(id) on delete set null,
  budgeted_hours numeric not null default 0,
  week_hours jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.manpower_upcoming_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  start_end text not null default '',
  gc text not null default '',
  location text not null default '',
  sort_order int not null default 0
);

alter table public.manpower_supers enable row level security;
alter table public.manpower_sessions enable row level security;
alter table public.manpower_employees enable row level security;
alter table public.manpower_weeks enable row level security;
alter table public.manpower_jobs enable row level security;
alter table public.manpower_assignments enable row level security;
alter table public.manpower_transfer_options enable row level security;
alter table public.manpower_hours_jobs enable row level security;
alter table public.manpower_upcoming_projects enable row level security;
