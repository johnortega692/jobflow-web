alter table public.paint_meetings
  add column if not exists locked boolean not null default false;

create or replace function public.paint_meetings_guard_lock()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.locked then
      raise exception 'This meeting is locked.';
    end if;
    return old;
  end if;

  if old.locked and new.locked then
    raise exception 'This meeting is locked.';
  end if;

  if old.locked and not new.locked then
    if not public.is_app_admin() then
      raise exception 'Only an admin can unlock this meeting.';
    end if;
    if new.title is distinct from old.title
      or new.meeting_on is distinct from old.meeting_on
      or new.content is distinct from old.content
      or new.created_by is distinct from old.created_by
    then
      raise exception 'Unlock the meeting before editing it.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.paint_meetings_guard_lock() from public, anon, authenticated;

drop trigger if exists paint_meetings_guard_lock on public.paint_meetings;
create trigger paint_meetings_guard_lock
  before update or delete on public.paint_meetings
  for each row execute function public.paint_meetings_guard_lock();
