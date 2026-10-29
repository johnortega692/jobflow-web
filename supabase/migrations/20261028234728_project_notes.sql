-- Per-project notes, follow-ups, and flags.

create table if not exists public.project_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  body text not null,
  type text not null default 'note' check (type in ('note', 'follow_up', 'flag')),
  status text not null default 'open' check (status in ('open', 'done')),
  follow_up_date date,
  waiting_on text,
  completed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_notes_project_id_status_idx
  on public.project_notes (project_id, status);

create index if not exists project_notes_status_follow_up_date_idx
  on public.project_notes (status, follow_up_date);

drop trigger if exists project_notes_updated_at on public.project_notes;
create trigger project_notes_updated_at
  before update on public.project_notes
  for each row execute function public.set_updated_at();

alter table public.project_notes enable row level security;

drop policy if exists "project_notes_select" on public.project_notes;
create policy "project_notes_select" on public.project_notes
  for select to authenticated
  using (public.is_approved_user());

drop policy if exists "project_notes_insert" on public.project_notes;
create policy "project_notes_insert" on public.project_notes
  for insert to authenticated
  with check (public.is_approved_user());

drop policy if exists "project_notes_update" on public.project_notes;
create policy "project_notes_update" on public.project_notes
  for update to authenticated
  using (public.is_approved_user());

drop policy if exists "project_notes_delete" on public.project_notes;
create policy "project_notes_delete" on public.project_notes
  for delete to authenticated
  using (public.is_approved_user());
