-- Change-order flag on a note. Open COR notes surface in Needs attention.

alter table public.project_notes
  add column if not exists cor boolean not null default false;

create index if not exists project_notes_open_cor_idx
  on public.project_notes (project_id)
  where status = 'open' and cor;
