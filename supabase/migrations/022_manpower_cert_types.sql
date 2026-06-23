-- Flexible training/cert types + email on workforce profiles.

drop function if exists public.manpower_update_workforce_profile(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text, boolean
);

alter table public.manpower_employees
  add column if not exists email text not null default '';

create table if not exists public.manpower_cert_types (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  sort_order int not null default 0,
  input_kind text not null default 'date'
    check (input_kind in ('date', 'yes_no', 'text')),
  active boolean not null default true,
  legacy_key text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.manpower_employee_certs (
  employee_id uuid not null references public.manpower_employees(id) on delete cascade,
  cert_type_id uuid not null references public.manpower_cert_types(id) on delete cascade,
  value text not null default '',
  updated_at timestamptz not null default now(),
  primary key (employee_id, cert_type_id)
);

create index if not exists manpower_employee_certs_type_idx
  on public.manpower_employee_certs (cert_type_id);

alter table public.manpower_cert_types enable row level security;
alter table public.manpower_employee_certs enable row level security;

insert into public.manpower_cert_types (label, sort_order, input_kind, legacy_key)
values
  ('Ladder Safety', 0, 'date', 'cert_ladder_safety'),
  ('Harassment Training', 1, 'date', 'cert_harassment'),
  ('Confined Space', 2, 'date', 'cert_confined_space'),
  ('Swing Stage', 3, 'date', 'cert_swing_stage'),
  ('Scaffold', 4, 'date', 'cert_scaffold'),
  ('Traffic Control', 5, 'date', 'cert_traffic_control'),
  ('Silica in Construction', 6, 'date', 'cert_silica'),
  ('Lead Renovation', 7, 'date', 'cert_lead_renovation'),
  ('OSHA 30', 8, 'yes_no', 'osha_30')
on conflict (legacy_key) do nothing;

insert into public.manpower_employee_certs (employee_id, cert_type_id, value)
select e.id, ct.id, e.cert_ladder_safety
from public.manpower_employees e
join public.manpower_cert_types ct on ct.legacy_key = 'cert_ladder_safety'
where coalesce(e.cert_ladder_safety, '') <> ''
on conflict (employee_id, cert_type_id) do update set value = excluded.value, updated_at = now();

insert into public.manpower_employee_certs (employee_id, cert_type_id, value)
select e.id, ct.id, e.cert_harassment
from public.manpower_employees e
join public.manpower_cert_types ct on ct.legacy_key = 'cert_harassment'
where coalesce(e.cert_harassment, '') <> ''
on conflict (employee_id, cert_type_id) do update set value = excluded.value, updated_at = now();

insert into public.manpower_employee_certs (employee_id, cert_type_id, value)
select e.id, ct.id, e.cert_confined_space
from public.manpower_employees e
join public.manpower_cert_types ct on ct.legacy_key = 'cert_confined_space'
where coalesce(e.cert_confined_space, '') <> ''
on conflict (employee_id, cert_type_id) do update set value = excluded.value, updated_at = now();

insert into public.manpower_employee_certs (employee_id, cert_type_id, value)
select e.id, ct.id, e.cert_swing_stage
from public.manpower_employees e
join public.manpower_cert_types ct on ct.legacy_key = 'cert_swing_stage'
where coalesce(e.cert_swing_stage, '') <> ''
on conflict (employee_id, cert_type_id) do update set value = excluded.value, updated_at = now();

insert into public.manpower_employee_certs (employee_id, cert_type_id, value)
select e.id, ct.id, e.cert_scaffold
from public.manpower_employees e
join public.manpower_cert_types ct on ct.legacy_key = 'cert_scaffold'
where coalesce(e.cert_scaffold, '') <> ''
on conflict (employee_id, cert_type_id) do update set value = excluded.value, updated_at = now();

insert into public.manpower_employee_certs (employee_id, cert_type_id, value)
select e.id, ct.id, e.cert_traffic_control
from public.manpower_employees e
join public.manpower_cert_types ct on ct.legacy_key = 'cert_traffic_control'
where coalesce(e.cert_traffic_control, '') <> ''
on conflict (employee_id, cert_type_id) do update set value = excluded.value, updated_at = now();

insert into public.manpower_employee_certs (employee_id, cert_type_id, value)
select e.id, ct.id, e.cert_silica
from public.manpower_employees e
join public.manpower_cert_types ct on ct.legacy_key = 'cert_silica'
where coalesce(e.cert_silica, '') <> ''
on conflict (employee_id, cert_type_id) do update set value = excluded.value, updated_at = now();

insert into public.manpower_employee_certs (employee_id, cert_type_id, value)
select e.id, ct.id, e.cert_lead_renovation
from public.manpower_employees e
join public.manpower_cert_types ct on ct.legacy_key = 'cert_lead_renovation'
where coalesce(e.cert_lead_renovation, '') <> ''
on conflict (employee_id, cert_type_id) do update set value = excluded.value, updated_at = now();

insert into public.manpower_employee_certs (employee_id, cert_type_id, value)
select e.id, ct.id, case when e.osha_30 then 'Yes' else 'No' end
from public.manpower_employees e
join public.manpower_cert_types ct on ct.legacy_key = 'osha_30'
on conflict (employee_id, cert_type_id) do update set value = excluded.value, updated_at = now();

create or replace function manpower_api.cert_types_json()
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', ct.id,
        'label', ct.label,
        'sort_order', ct.sort_order,
        'input_kind', ct.input_kind,
        'active', ct.active
      )
      order by ct.active desc, ct.sort_order, ct.label
    ),
    '[]'::jsonb
  )
  from public.manpower_cert_types ct;
$$;

create or replace function manpower_api.employee_certs_json(p_employee_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'cert_type_id', ec.cert_type_id,
        'value', ec.value
      )
      order by ct.sort_order, ct.label
    ),
    '[]'::jsonb
  )
  from public.manpower_employee_certs ec
  join public.manpower_cert_types ct on ct.id = ec.cert_type_id
  where ec.employee_id = p_employee_id
    and ct.active;
$$;

create or replace function manpower_api.workforce_employee_json(e public.manpower_employees)
returns jsonb
language sql
stable
set search_path = public, manpower_api
as $$
  select jsonb_build_object(
    'id', e.id,
    'name', e.name,
    'role', e.role,
    'active', e.active,
    'sort_order', e.sort_order,
    'phone', e.phone,
    'email', e.email,
    'notes', e.notes,
    'certs', manpower_api.employee_certs_json(e.id),
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
  return jsonb_build_object(
    'cert_types', manpower_api.cert_types_json(),
    'employees', (
      select coalesce(
        jsonb_agg(
          manpower_api.workforce_employee_json(e)
          order by e.active desc, e.sort_order, e.name
        ),
        '[]'::jsonb
      )
      from public.manpower_employees e
    )
  );
end;
$$;

create or replace function manpower_api.upsert_employee_certs(
  p_employee_id uuid,
  p_certs jsonb
)
returns void
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare item jsonb;
declare cid uuid;
declare cval text;
begin
  if p_certs is null or jsonb_typeof(p_certs) <> 'array' then
    return;
  end if;

  for item in select * from jsonb_array_elements(p_certs)
  loop
    cid := (item->>'cert_type_id')::uuid;
    cval := coalesce(item->>'value', '');

    if cid is null then
      continue;
    end if;

    if not exists (
      select 1 from public.manpower_cert_types ct
      where ct.id = cid and ct.active
    ) then
      continue;
    end if;

    insert into public.manpower_employee_certs (employee_id, cert_type_id, value)
    values (p_employee_id, cid, cval)
    on conflict (employee_id, cert_type_id)
    do update set value = excluded.value, updated_at = now();
  end loop;
end;
$$;

create or replace function manpower_api.update_workforce_profile(
  p_token uuid,
  p_employee_id uuid,
  p_phone text default null,
  p_email text default null,
  p_notes text default null,
  p_certs jsonb default null
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
    email = coalesce(p_email, e.email),
    notes = coalesce(p_notes, e.notes),
    profile_updated_at = now()
  where e.id = p_employee_id;

  if not found then
    raise exception 'EMPLOYEE_NOT_FOUND' using errcode = 'P0001';
  end if;

  perform manpower_api.upsert_employee_certs(p_employee_id, p_certs);
  return true;
end;
$$;

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
  perform manpower_api.require_super(p_token);

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
  perform manpower_api.require_super(p_token);

  update public.manpower_cert_types
  set active = p_active
  where id = p_cert_type_id;

  if not found then
    raise exception 'CERT_TYPE_NOT_FOUND' using errcode = 'P0001';
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
  p_email text default null,
  p_notes text default null,
  p_certs jsonb default null
)
returns boolean
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.update_workforce_profile(
  p_token,
  p_employee_id,
  p_phone,
  p_email,
  p_notes,
  p_certs
); $$;

create or replace function public.manpower_add_cert_type(
  p_token uuid,
  p_label text,
  p_input_kind text default 'date'
)
returns uuid
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.add_cert_type(p_token, p_label, p_input_kind); $$;

create or replace function public.manpower_set_cert_type_active(
  p_token uuid,
  p_cert_type_id uuid,
  p_active boolean
)
returns boolean
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.set_cert_type_active(p_token, p_cert_type_id, p_active); $$;

notify pgrst, 'reload schema';
