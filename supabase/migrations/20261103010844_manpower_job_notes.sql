-- Per-job notes on the Manpower Hours Tracker.
-- Manpower uses PIN sessions, so the table is closed to direct access and every read and write
-- goes through manpower_api functions that check the session token and the note's author.

create table if not exists public.job_notes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.manpower_hours_jobs(id) on delete cascade,
  body text not null,
  author_name text not null,
  author_id uuid references public.manpower_supers(id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  constraint job_notes_body_len check (char_length(btrim(body)) between 1 and 4000)
);

create index if not exists job_notes_job_created_idx
  on public.job_notes (job_id, created_at desc);

alter table public.job_notes enable row level security;
revoke all on table public.job_notes from public, anon, authenticated;

comment on table public.job_notes is
  'Notes on a Manpower Hours Tracker job. author_id is the manpower_supers row that wrote it.';

create or replace function manpower_api.job_note_json(n public.job_notes, p_viewer uuid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', n.id,
    'job_id', n.job_id,
    'body', n.body,
    'author_name', n.author_name,
    'created_at', n.created_at,
    'edited_at', n.edited_at,
    'is_mine', n.author_id is not null and n.author_id = p_viewer
  );
$$;

create or replace function manpower_api.list_job_note_summaries(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, manpower_api
as $$
begin
  perform manpower_api.require_viewer(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'job_id', s.job_id,
      'count', s.cnt,
      'latest_body', s.latest_body,
      'latest_at', s.latest_at
    ))
    from (
      select job_id,
             count(*) as cnt,
             (array_agg(body order by created_at desc))[1] as latest_body,
             max(created_at) as latest_at
      from public.job_notes
      group by job_id
    ) s
  ), '[]'::jsonb);
end;
$$;

create or replace function manpower_api.list_job_notes(p_token uuid, p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  v_super public.manpower_supers;
begin
  v_super := manpower_api.require_viewer(p_token);
  return coalesce((
    select jsonb_agg(manpower_api.job_note_json(n, v_super.id) order by n.created_at desc)
    from public.job_notes n
    where n.job_id = p_job_id
  ), '[]'::jsonb);
end;
$$;

-- p_job_name is used when the schedule job has no hours tracker row yet. The row is created the same
-- way manpower_api.set_hours_budget creates one (trimmed name, budget 0), and an existing row is left as is.
create or replace function manpower_api.add_job_note(
  p_token uuid,
  p_job_id uuid,
  p_body text,
  p_job_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  v_super public.manpower_supers;
  v_body text := btrim(coalesce(p_body, ''));
  v_name text := btrim(coalesce(p_job_name, ''));
  v_job uuid;
  n public.job_notes;
begin
  v_super := manpower_api.require_super(p_token);

  if v_body = '' then
    raise exception 'NOTE_EMPTY' using errcode = 'P0001';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'NOTE_TOO_LONG' using errcode = 'P0001';
  end if;

  if p_job_id is not null then
    select h.id into v_job from public.manpower_hours_jobs h where h.id = p_job_id;
    if v_job is null then
      raise exception 'JOB_NOT_FOUND' using errcode = 'P0001';
    end if;
  else
    if v_name = '' then
      raise exception 'JOB_NOT_FOUND' using errcode = 'P0001';
    end if;
    if lower(v_name) = lower(manpower_api.training_job_name()) then
      raise exception 'JOB_NOT_FOUND' using errcode = 'P0001';
    end if;
    insert into public.manpower_hours_jobs (job_name, budgeted_hours, updated_at)
    values (v_name, 0, now())
    on conflict (job_name) do nothing;
    select h.id into v_job from public.manpower_hours_jobs h where h.job_name = v_name;
  end if;

  insert into public.job_notes (job_id, body, author_name, author_id)
  values (v_job, v_body, coalesce(nullif(btrim(v_super.name), ''), 'Manpower Cal'), v_super.id)
  returning * into n;

  return manpower_api.job_note_json(n, v_super.id);
end;
$$;

create or replace function manpower_api.update_job_note(p_token uuid, p_note_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  v_super public.manpower_supers;
  v_body text := btrim(coalesce(p_body, ''));
  n public.job_notes;
begin
  v_super := manpower_api.require_super(p_token);

  if v_body = '' then
    raise exception 'NOTE_EMPTY' using errcode = 'P0001';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'NOTE_TOO_LONG' using errcode = 'P0001';
  end if;

  update public.job_notes
  set body = v_body,
      edited_at = now()
  where id = p_note_id
    and author_id = v_super.id
  returning * into n;

  if not found then
    raise exception 'NOTE_NOT_YOURS' using errcode = 'P0001';
  end if;

  return manpower_api.job_note_json(n, v_super.id);
end;
$$;

create or replace function manpower_api.delete_job_note(p_token uuid, p_note_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  v_super public.manpower_supers;
begin
  v_super := manpower_api.require_super(p_token);

  delete from public.job_notes
  where id = p_note_id
    and author_id = v_super.id;

  if not found then
    raise exception 'NOTE_NOT_YOURS' using errcode = 'P0001';
  end if;

  return true;
end;
$$;

create or replace function public.manpower_list_job_note_summaries(p_token uuid)
returns jsonb
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.list_job_note_summaries(p_token); $$;

create or replace function public.manpower_list_job_notes(p_token uuid, p_job_id uuid)
returns jsonb
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.list_job_notes(p_token, p_job_id); $$;

create or replace function public.manpower_add_job_note(
  p_token uuid,
  p_job_id uuid,
  p_body text,
  p_job_name text default null
)
returns jsonb
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.add_job_note(p_token, p_job_id, p_body, p_job_name); $$;

create or replace function public.manpower_update_job_note(p_token uuid, p_note_id uuid, p_body text)
returns jsonb
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.update_job_note(p_token, p_note_id, p_body); $$;

create or replace function public.manpower_delete_job_note(p_token uuid, p_note_id uuid)
returns boolean
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.delete_job_note(p_token, p_note_id); $$;

revoke all on function manpower_api.job_note_json(public.job_notes, uuid) from public, anon, authenticated;
revoke all on function manpower_api.list_job_note_summaries(uuid) from public;
revoke all on function manpower_api.list_job_notes(uuid, uuid) from public;
revoke all on function manpower_api.add_job_note(uuid, uuid, text, text) from public;
revoke all on function manpower_api.update_job_note(uuid, uuid, text) from public;
revoke all on function manpower_api.delete_job_note(uuid, uuid) from public;

grant execute on function manpower_api.list_job_note_summaries(uuid) to anon, authenticated;
grant execute on function manpower_api.list_job_notes(uuid, uuid) to anon, authenticated;
grant execute on function manpower_api.add_job_note(uuid, uuid, text, text) to anon, authenticated;
grant execute on function manpower_api.update_job_note(uuid, uuid, text) to anon, authenticated;
grant execute on function manpower_api.delete_job_note(uuid, uuid) to anon, authenticated;

grant execute on function public.manpower_list_job_note_summaries(uuid) to anon, authenticated;
grant execute on function public.manpower_list_job_notes(uuid, uuid) to anon, authenticated;
grant execute on function public.manpower_add_job_note(uuid, uuid, text, text) to anon, authenticated;
grant execute on function public.manpower_update_job_note(uuid, uuid, text) to anon, authenticated;
grant execute on function public.manpower_delete_job_note(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
