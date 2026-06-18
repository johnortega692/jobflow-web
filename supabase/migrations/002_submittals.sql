-- Run in Supabase SQL Editor after schema.sql (submittal log for web app)

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
create index if not exists submittals_line_idx on submittals (project_id, line_number);

drop trigger if exists submittals_updated_at on submittals;
create trigger submittals_updated_at
  before update on submittals
  for each row execute function public.set_updated_at();

alter table submittals enable row level security;

drop policy if exists "submittals_select" on submittals;
create policy "submittals_select" on submittals for select to authenticated using (true);

drop policy if exists "submittals_insert" on submittals;
create policy "submittals_insert" on submittals for insert to authenticated with check (true);

drop policy if exists "submittals_update" on submittals;
create policy "submittals_update" on submittals for update to authenticated using (true);

drop policy if exists "submittals_delete" on submittals;
create policy "submittals_delete" on submittals for delete to authenticated using (true);
