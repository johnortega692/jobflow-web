-- Track who last touched a shared project and append-only edit history.

alter table public.projects
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

create table if not exists public.project_activity (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  user_name text not null default '',
  action text not null,
  summary text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists project_activity_project_id_created_at_idx
  on public.project_activity (project_id, created_at desc);

alter table public.project_activity enable row level security;

drop policy if exists "project_activity_select" on public.project_activity;
create policy "project_activity_select" on public.project_activity
  for select to authenticated using (true);

drop policy if exists "project_activity_insert" on public.project_activity;
create policy "project_activity_insert" on public.project_activity
  for insert to authenticated with check (true);
