-- Permission tweak: supers mark inactive/reactivate; admin manages training option list.

create or replace function manpower_api.set_employee_active(
  p_token uuid,
  p_employee_id uuid,
  p_active boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, manpower_api
as $$
begin
  perform manpower_api.require_super(p_token);
  update public.manpower_employees
  set active = p_active
  where id = p_employee_id;

  if not found then
    raise exception 'EMPLOYEE_NOT_FOUND' using errcode = 'P0001';
  end if;

  return true;
end;
$$;

create or replace function public.manpower_set_employee_active(
  p_token uuid,
  p_employee_id uuid,
  p_active boolean
)
returns boolean
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.set_employee_active(p_token, p_employee_id, p_active); $$;

create or replace function manpower_api.add_cert_type(
  p_token uuid,
  p_label text,
  p_input_kind text default 'date'
)
returns uuid
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare tid uuid;
declare kind text;
declare next_order int;
begin
  perform manpower_api.require_admin(p_token);

  if p_label is null or length(trim(p_label)) = 0 then
    raise exception 'LABEL_REQUIRED' using errcode = 'P0001';
  end if;

  kind := coalesce(nullif(trim(p_input_kind), ''), 'date');
  if kind not in ('date', 'yes_no', 'text') then
    raise exception 'INVALID_INPUT_KIND' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.manpower_cert_types ct
    where lower(trim(ct.label)) = lower(trim(p_label))
  ) then
    raise exception 'DUPLICATE_CERT_TYPE' using errcode = 'P0001';
  end if;

  select coalesce(max(sort_order), -1) + 1 into next_order
  from public.manpower_cert_types;

  insert into public.manpower_cert_types (label, sort_order, input_kind)
  values (trim(p_label), next_order, kind)
  returning id into tid;

  return tid;
end;
$$;

create or replace function manpower_api.set_cert_type_active(
  p_token uuid,
  p_cert_type_id uuid,
  p_active boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, manpower_api
as $$
begin
  perform manpower_api.require_admin(p_token);

  update public.manpower_cert_types
  set active = p_active
  where id = p_cert_type_id;

  if not found then
    raise exception 'CERT_TYPE_NOT_FOUND' using errcode = 'P0001';
  end if;

  return true;
end;
$$;

notify pgrst, 'reload schema';
