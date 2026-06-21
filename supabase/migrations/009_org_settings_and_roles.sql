-- Shared Google Apps Script URLs + admin/user roles for Settings.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  app_role text not null default 'user' check (app_role in ('admin', 'user')),
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists app_role text;
update public.profiles set app_role = 'user' where app_role is null;
alter table public.profiles alter column app_role set default 'user';
alter table public.profiles alter column app_role set not null;
alter table public.profiles drop constraint if exists profiles_app_role_check;
alter table public.profiles add constraint profiles_app_role_check check (app_role in ('admin', 'user'));

create table if not exists public.org_settings (
  id int primary key default 1 check (id = 1),
  google_urls jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.org_settings (id, google_urls)
values (1, '{}'::jsonb)
on conflict (id) do nothing;

-- Seed shared URLs from the admin account's legacy user_settings row (if present).
update public.org_settings os
set google_urls = u.settings->'google_urls',
    updated_by = u.user_id,
    updated_at = now()
from public.user_settings u
join auth.users a on a.id = u.user_id
where os.id = 1
  and lower(a.email) = 'johnortega@gmail.com'
  and u.settings ? 'google_urls'
  and u.settings->'google_urls' <> '{}'::jsonb;

-- Profiles for existing auth users.
insert into public.profiles (id, app_role)
select id, 'user' from auth.users
on conflict (id) do nothing;

update public.profiles p
set app_role = 'admin'
from auth.users a
where p.id = a.id and lower(a.email) = 'johnortega@gmail.com';

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (auth.uid() = id);

alter table public.org_settings enable row level security;

drop policy if exists "org_settings_select" on public.org_settings;
create policy "org_settings_select" on public.org_settings
  for select to authenticated using (true);

drop policy if exists "org_settings_insert_admin" on public.org_settings;
create policy "org_settings_insert_admin" on public.org_settings
  for insert to authenticated
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and app_role = 'admin')
  );

drop policy if exists "org_settings_update_admin" on public.org_settings;
create policy "org_settings_update_admin" on public.org_settings
  for update to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and app_role = 'admin')
  );

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, app_role)
  values (
    new.id,
    case when lower(coalesce(new.email, '')) = 'johnortega@gmail.com' then 'admin' else 'user' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
