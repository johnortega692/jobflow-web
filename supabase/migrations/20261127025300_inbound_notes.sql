-- Match a forwarded note to a job by the mailbox name, and file each email once.

alter table public.projects
  add column if not exists job_number_key text
  generated always as (lower(regexp_replace(job_number, '[^a-zA-Z0-9]', '', 'g'))) stored;

create index if not exists projects_job_number_key_idx
  on public.projects (job_number_key);

alter table public.project_notes
  add column if not exists email_message_id text;

create unique index if not exists project_notes_email_message_id_idx
  on public.project_notes (email_message_id)
  where email_message_id is not null;
