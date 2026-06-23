-- Role tallies + admin control for which roles appear in Add Personnel.

create table if not exists public.manpower_role_settings (
  role text primary key
    check (role in ('foreman', 'leadman', 'apprentice', 'wallcovering', 'journeyman')),
  visible_in_add boolean not null default true,
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.manpower_role_settings (role, sort_order, visible_in_add)
values
  ('journeyman', 0, true),
  ('foreman', 1, true),
  ('leadman', 2, true),
  ('apprentice', 3, true),
  ('wallcovering', 4, true)
on conflict (role) do nothing;

alter table public.manpower_role_settings enable row level security;

create or replace function manpower_api.role_settings_json()
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'role', r.role,
        'visible_in_add', r.visible_in_add,
        'sort_order', r.sort_order
      )
      order by r.sort_order, r.role
    ),
    '[]'::jsonb
  )
  from public.manpower_role_settings r;
$$;

create or replace function manpower_api.admin_list_role_settings(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, manpower_api
as $$
begin
  perform manpower_api.require_admin(p_token);
  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'role', rs.role,
          'visible_in_add', rs.visible_in_add,
          'sort_order', rs.sort_order,
          'crew_count', (
            select count(*)::int
            from public.manpower_employees e
            where e.active
              and (
                e.role = rs.role
                or (rs.role = 'journeyman' and e.role = 'normal')
              )
          )
        )
        order by rs.sort_order, rs.role
      ),
      '[]'::jsonb
    )
    from public.manpower_role_settings rs
  );
end;
$$;

create or replace function manpower_api.admin_set_role_visible(
  p_token uuid,
  p_role text,
  p_visible boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare visible_count int;
begin
  perform manpower_api.require_admin(p_token);

  if p_role not in ('foreman', 'leadman', 'apprentice', 'wallcovering', 'journeyman') then
    raise exception 'INVALID_ROLE' using errcode = 'P0001';
  end if;

  if not p_visible then
    select count(*) into visible_count
    from public.manpower_role_settings
    where visible_in_add and role <> p_role;

    if visible_count = 0 then
      raise exception 'LAST_VISIBLE_ROLE' using errcode = 'P0001';
    end if;
  end if;

  update public.manpower_role_settings
  set visible_in_add = p_visible, updated_at = now()
  where role = p_role;

  return true;
end;
$$;

create or replace function public.manpower_admin_list_role_settings(p_token uuid)
returns jsonb
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.admin_list_role_settings(p_token); $$;

create or replace function public.manpower_admin_set_role_visible(
  p_token uuid,
  p_role text,
  p_visible boolean
)
returns boolean
language sql
security invoker
set search_path = public, manpower_api
as $$ select manpower_api.admin_set_role_visible(p_token, p_role, p_visible); $$;

notify pgrst, 'reload schema';
