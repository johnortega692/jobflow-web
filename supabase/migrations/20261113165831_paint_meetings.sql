-- Company paint meeting agendas and minutes.

create table if not exists public.paint_meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  meeting_on date,
  content jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists paint_meetings_meeting_on_idx
  on public.paint_meetings (meeting_on desc nulls last, updated_at desc);

drop trigger if exists paint_meetings_updated_at on public.paint_meetings;
create trigger paint_meetings_updated_at
  before update on public.paint_meetings
  for each row execute function public.set_updated_at();

alter table public.paint_meetings enable row level security;

drop policy if exists "paint_meetings_select" on public.paint_meetings;
create policy "paint_meetings_select" on public.paint_meetings
  for select to authenticated
  using (public.is_approved_user());

drop policy if exists "paint_meetings_insert" on public.paint_meetings;
create policy "paint_meetings_insert" on public.paint_meetings
  for insert to authenticated
  with check (public.is_approved_user());

drop policy if exists "paint_meetings_update" on public.paint_meetings;
create policy "paint_meetings_update" on public.paint_meetings
  for update to authenticated
  using (public.is_approved_user())
  with check (public.is_approved_user());

drop policy if exists "paint_meetings_delete" on public.paint_meetings;
create policy "paint_meetings_delete" on public.paint_meetings
  for delete to authenticated
  using (public.is_approved_user());
