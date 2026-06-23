-- Work Force tab: crew mini-profiles with certifications (active + inactive retained).

alter table public.manpower_employees
  add column if not exists phone text not null default '',
  add column if not exists notes text not null default '',
  add column if not exists cert_ladder_safety text not null default '',
  add column if not exists cert_harassment text not null default '',
  add column if not exists cert_confined_space text not null default '',
  add column if not exists cert_swing_stage text not null default '',
  add column if not exists cert_scaffold text not null default '',
  add column if not exists cert_traffic_control text not null default '',
  add column if not exists cert_silica text not null default '',
  add column if not exists cert_lead_renovation text not null default '',
  add column if not exists osha_30 boolean not null default false,
  add column if not exists profile_updated_at timestamptz;

create or replace function manpower_api.workforce_employee_json(e public.manpower_employees)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'id', e.id,
    'name', e.name,
    'role', e.role,
    'active', e.active,
    'sort_order', e.sort_order,
    'phone', e.phone,
    'notes', e.notes,
    'cert_ladder_safety', e.cert_ladder_safety,
    'cert_harassment', e.cert_harassment,
    'cert_confined_space', e.cert_confined_space,
    'cert_swing_stage', e.cert_swing_stage,
    'cert_scaffold', e.cert_scaffold,
    'cert_traffic_control', e.cert_traffic_control,
    'cert_silica', e.cert_silica,
    'cert_lead_renovation', e.cert_lead_renovation,
    'osha_30', e.osha_30,
    'profile_updated_at', e.profile_updated_at
  );
$$;

create or replace function manpower_api.list_workforce(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, manpower_api
as $$
begin
  perform manpower_api.require_super(p_token);
  return (
    select coalesce(
      jsonb_agg(
        manpower_api.workforce_employee_json(e)
        order by e.active desc, e.sort_order, e.name
      ),
      '[]'::jsonb
    )
    from public.manpower_employees e
  );
end;
$$;

create or replace function manpower_api.update_workforce_profile(
  p_token uuid,
  p_employee_id uuid,
  p_phone text default null,
  p_notes text default null,
  p_cert_ladder_safety text default null,
  p_cert_harassment text default null,
  p_cert_confined_space text default null,
  p_cert_swing_stage text default null,
  p_cert_scaffold text default null,
  p_cert_traffic_control text default null,
  p_cert_silica text default null,
  p_cert_lead_renovation text default null,
  p_osha_30 boolean default null
)
returns boolean
language plpgsql
security definer
set search_path = public, manpower_api
as $$
begin
  perform manpower_api.require_super(p_token);

  update public.manpower_employees e
  set
    phone = coalesce(p_phone, e.phone),
    notes = coalesce(p_notes, e.notes),
    cert_ladder_safety = coalesce(p_cert_ladder_safety, e.cert_ladder_safety),
    cert_harassment = coalesce(p_cert_harassment, e.cert_harassment),
    cert_confined_space = coalesce(p_cert_confined_space, e.cert_confined_space),
    cert_swing_stage = coalesce(p_cert_swing_stage, e.cert_swing_stage),
    cert_scaffold = coalesce(p_cert_scaffold, e.cert_scaffold),
    cert_traffic_control = coalesce(p_cert_traffic_control, e.cert_traffic_control),
    cert_silica = coalesce(p_cert_silica, e.cert_silica),
    cert_lead_renovation = coalesce(p_cert_lead_renovation, e.cert_lead_renovation),
    osha_30 = coalesce(p_osha_30, e.osha_30),
    profile_updated_at = now()
  where e.id = p_employee_id;

  if not found then
    raise exception 'EMPLOYEE_NOT_FOUND' using errcode = 'P0001';
  end if;

  return true;
end;
$$;

create or replace function public.manpower_list_workforce(p_token uuid)
returns jsonb
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.list_workforce(p_token); $$;

create or replace function public.manpower_update_workforce_profile(
  p_token uuid,
  p_employee_id uuid,
  p_phone text default null,
  p_notes text default null,
  p_cert_ladder_safety text default null,
  p_cert_harassment text default null,
  p_cert_confined_space text default null,
  p_cert_swing_stage text default null,
  p_cert_scaffold text default null,
  p_cert_traffic_control text default null,
  p_cert_silica text default null,
  p_cert_lead_renovation text default null,
  p_osha_30 boolean default null
)
returns boolean
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.update_workforce_profile(
  p_token,
  p_employee_id,
  p_phone,
  p_notes,
  p_cert_ladder_safety,
  p_cert_harassment,
  p_cert_confined_space,
  p_cert_swing_stage,
  p_cert_scaffold,
  p_cert_traffic_control,
  p_cert_silica,
  p_cert_lead_renovation,
  p_osha_30
); $$;

notify pgrst, 'reload schema';
