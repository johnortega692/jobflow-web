-- Optional dates for when exterior rain watch applies.
-- Both null means the whole job. One null leaves that side open.

alter table public.projects
  add column if not exists exterior_start date,
  add column if not exists exterior_end date;

comment on column public.projects.exterior_start is
  'First day exterior rain watch applies. Null leaves that side open.';
comment on column public.projects.exterior_end is
  'Last day exterior rain watch applies. Null leaves that side open.';

alter table public.projects drop constraint if exists projects_exterior_window_order;
alter table public.projects
  add constraint projects_exterior_window_order
  check (exterior_end is null or exterior_start is null or exterior_end >= exterior_start);
