-- Fix pgcrypto: Supabase installs it in the extensions schema

create or replace function manpower_api.login(p_pin text)
returns jsonb
language plpgsql security definer set search_path = public, manpower_api, extensions
as $$
declare s public.manpower_supers; tok uuid; exp timestamptz;
begin
  if p_pin is null or length(trim(p_pin)) < 4 then
    raise exception 'INVALID_PIN' using errcode = 'P0001';
  end if;
  select * into s from public.manpower_supers
  where active and pin_hash = crypt(trim(p_pin), pin_hash)
  order by is_admin desc limit 1;
  if not found then raise exception 'INVALID_PIN' using errcode = 'P0001'; end if;
  exp := now() + interval '12 hours';
  insert into public.manpower_sessions (super_id, expires_at) values (s.id, exp) returning token into tok;
  return jsonb_build_object(
    'token', tok, 'expires_at', exp,
    'super', jsonb_build_object('id', s.id, 'name', s.name, 'is_admin', s.is_admin, 'supervisor_label', s.supervisor_label)
  );
end;
$$;

create or replace function manpower_api.admin_upsert_super(
  p_token uuid, p_name text, p_pin text, p_supervisor_label text default null,
  p_is_admin boolean default false, p_super_id uuid default null
)
returns uuid language plpgsql security definer set search_path = public, manpower_api, extensions
as $$
declare sid uuid;
begin
  perform manpower_api.require_admin(p_token);
  if p_super_id is null then
    insert into public.manpower_supers (name, pin_hash, supervisor_label, is_admin)
    values (trim(p_name), crypt(trim(p_pin), gen_salt('bf')), p_supervisor_label, coalesce(p_is_admin, false))
    returning id into sid;
  else
    update public.manpower_supers set name = trim(p_name), supervisor_label = p_supervisor_label,
      is_admin = coalesce(p_is_admin, is_admin),
      pin_hash = case when p_pin is not null and length(trim(p_pin)) >= 4
        then crypt(trim(p_pin), gen_salt('bf')) else pin_hash end,
      updated_at = now() where id = p_super_id returning id into sid;
  end if;
  return sid;
end;
$$;

-- Re-hash default PINs (prior seed may have failed silently)
update public.manpower_supers set pin_hash = crypt('0000', gen_salt('bf')), updated_at = now() where name = 'Office Admin';
update public.manpower_supers set pin_hash = crypt('1111', gen_salt('bf')), updated_at = now() where name = 'Robert';
update public.manpower_supers set pin_hash = crypt('2222', gen_salt('bf')), updated_at = now() where name = 'John';

notify pgrst, 'reload schema';
