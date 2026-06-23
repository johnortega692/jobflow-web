-- New JobFlow users require admin approval before accessing office data.

alter table public.profiles add column if not exists approved_at timestamptz;

update public.profiles
set approved_at = coalesce(approved_at, created_at, now())
where approved_at is null;

update public.profiles p
set approved_at = coalesce(p.approved_at, now()),
    app_role = 'admin'
from auth.users a
where p.id = a.id
  and lower(a.email) = 'johnortega@gmail.com';

create or replace function public.is_approved_user(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = uid
      and p.approved_at is not null
  );
$$;

create or replace function public.is_app_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = uid
      and p.app_role = 'admin'
      and p.approved_at is not null
  );
$$;

grant execute on function public.is_approved_user(uuid) to authenticated, anon;
grant execute on function public.is_app_admin(uuid) to authenticated, anon;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_bootstrap_admin boolean := lower(coalesce(new.email, '')) = 'johnortega@gmail.com';
begin
  insert into public.profiles (id, app_role, approved_at)
  values (
    new.id,
    case when is_bootstrap_admin then 'admin' else 'user' end,
    case when is_bootstrap_admin then now() else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated
  using (auth.uid() = id or public.is_app_admin());

drop policy if exists "org_settings_select" on public.org_settings;
create policy "org_settings_select" on public.org_settings
  for select to authenticated
  using (public.is_approved_user());

drop policy if exists "org_settings_insert_admin" on public.org_settings;
create policy "org_settings_insert_admin" on public.org_settings
  for insert to authenticated
  with check (public.is_app_admin());

drop policy if exists "org_settings_update_admin" on public.org_settings;
create policy "org_settings_update_admin" on public.org_settings
  for update to authenticated
  using (public.is_app_admin());

drop policy if exists "projects_select" on public.projects;
create policy "projects_select" on public.projects
  for select to authenticated
  using (public.is_approved_user());

drop policy if exists "projects_insert" on public.projects;
create policy "projects_insert" on public.projects
  for insert to authenticated
  with check (public.is_approved_user());

drop policy if exists "projects_update" on public.projects;
create policy "projects_update" on public.projects
  for update to authenticated
  using (public.is_approved_user());

drop policy if exists "projects_delete" on public.projects;
create policy "projects_delete" on public.projects
  for delete to authenticated
  using (public.is_approved_user());

drop policy if exists "rfis_select" on public.rfis;
create policy "rfis_select" on public.rfis
  for select to authenticated
  using (public.is_approved_user());

drop policy if exists "rfis_insert" on public.rfis;
create policy "rfis_insert" on public.rfis
  for insert to authenticated
  with check (public.is_approved_user());

drop policy if exists "rfis_update" on public.rfis;
create policy "rfis_update" on public.rfis
  for update to authenticated
  using (public.is_approved_user());

drop policy if exists "rfis_delete" on public.rfis;
create policy "rfis_delete" on public.rfis
  for delete to authenticated
  using (public.is_approved_user());

drop policy if exists "submittals_select" on public.submittals;
create policy "submittals_select" on public.submittals
  for select to authenticated
  using (public.is_approved_user());

drop policy if exists "submittals_insert" on public.submittals;
create policy "submittals_insert" on public.submittals
  for insert to authenticated
  with check (public.is_approved_user());

drop policy if exists "submittals_update" on public.submittals;
create policy "submittals_update" on public.submittals
  for update to authenticated
  using (public.is_approved_user());

drop policy if exists "submittals_delete" on public.submittals;
create policy "submittals_delete" on public.submittals
  for delete to authenticated
  using (public.is_approved_user());

drop policy if exists "work_orders_select" on public.work_orders;
create policy "work_orders_select" on public.work_orders
  for select to authenticated
  using (public.is_approved_user());

drop policy if exists "work_orders_insert" on public.work_orders;
create policy "work_orders_insert" on public.work_orders
  for insert to authenticated
  with check (public.is_approved_user());

drop policy if exists "work_orders_update" on public.work_orders;
create policy "work_orders_update" on public.work_orders
  for update to authenticated
  using (public.is_approved_user());

drop policy if exists "work_orders_delete" on public.work_orders;
create policy "work_orders_delete" on public.work_orders
  for delete to authenticated
  using (public.is_approved_user());

drop policy if exists "project_activity_select" on public.project_activity;
create policy "project_activity_select" on public.project_activity
  for select to authenticated
  using (public.is_approved_user());

drop policy if exists "project_activity_insert" on public.project_activity;
create policy "project_activity_insert" on public.project_activity
  for insert to authenticated
  with check (public.is_approved_user());

create or replace function public.list_pending_users()
returns table (
  user_id uuid,
  email text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select p.id, u.email::text, p.created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.approved_at is null
    and public.is_app_admin()
  order by p.created_at asc;
$$;

create or replace function public.approve_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Admin approval required';
  end if;

  update public.profiles
  set approved_at = now()
  where id = target_user_id
    and approved_at is null;

  if not found then
    raise exception 'User not found or already approved';
  end if;
end;
$$;

create or replace function public.reject_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Admin approval required';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'Cannot reject your own account';
  end if;

  delete from auth.users where id = target_user_id;
end;
$$;

grant execute on function public.list_pending_users() to authenticated;
grant execute on function public.approve_user(uuid) to authenticated;
grant execute on function public.reject_user(uuid) to authenticated;
