-- Next week creation (manual, like sheet "Create New Week Schedule")

create or replace function manpower_api.copy_jobs_from_week(p_dest uuid, p_source uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if p_source is null then return; end if;
  insert into public.manpower_jobs (week_id, name, project_id, supervisor_label, row_color, sort_order)
  select p_dest, name, project_id, supervisor_label, row_color, sort_order
  from public.manpower_jobs where week_id = p_source;
end;
$$;

create or replace function manpower_api.week_label_for_date(p_mon date)
returns text language sql immutable
as $$ select extract(month from p_mon)::int::text || '/' || extract(day from p_mon)::int::text; $$;

create or replace function manpower_api.monday_of_current_week()
returns date language sql stable
as $$ select current_date - ((extract(isodow from current_date)::int + 6) % 7); $$;

create or replace function manpower_api.create_next_week(p_token uuid)
returns uuid language plpgsql security definer set search_path = public, manpower_api
as $$
declare wid uuid; mon date; lbl text; prev_week uuid; latest date;
begin
  perform manpower_api.require_super(p_token);
  select max(week_start) into latest from public.manpower_weeks;
  if latest is null then
    return manpower_api.ensure_current_week(p_token);
  end if;
  mon := latest + 7;
  lbl := manpower_api.week_label_for_date(mon);
  select id into wid from public.manpower_weeks where week_label = lbl;
  if wid is not null then return wid; end if;
  insert into public.manpower_weeks (week_label, week_start) values (lbl, mon) returning id into wid;
  select id into prev_week from public.manpower_weeks where week_start = latest limit 1;
  perform manpower_api.copy_jobs_from_week(wid, prev_week);
  return wid;
end;
$$;

create or replace function public.manpower_create_next_week(p_token uuid) returns uuid
language sql security invoker set search_path = public, manpower_api
as $$ select manpower_api.create_next_week(p_token); $$;
