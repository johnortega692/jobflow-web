alter table public.project_notes
  add column if not exists updated_by uuid references auth.users (id) on delete set null;

alter table public.project_notes
  add column if not exists updated_by_name text;
