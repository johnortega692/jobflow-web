-- Per-user letterhead / PDF branding (logo, company, signer)

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists user_settings_updated_at on public.user_settings;
create trigger user_settings_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

alter table public.user_settings enable row level security;

drop policy if exists "user_settings_select_own" on public.user_settings;
create policy "user_settings_select_own" on public.user_settings
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "user_settings_insert_own" on public.user_settings;
create policy "user_settings_insert_own" on public.user_settings
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "user_settings_update_own" on public.user_settings;
create policy "user_settings_update_own" on public.user_settings
  for update to authenticated using (auth.uid() = user_id);

drop policy if exists "user_settings_delete_own" on public.user_settings;
create policy "user_settings_delete_own" on public.user_settings
  for delete to authenticated using (auth.uid() = user_id);

-- Optional logo uploads (public read; users write only under their folder)
insert into storage.buckets (id, name, public)
values ('letterhead', 'letterhead', true)
on conflict (id) do nothing;

drop policy if exists "letterhead_public_read" on storage.objects;
create policy "letterhead_public_read" on storage.objects
  for select to public using (bucket_id = 'letterhead');

drop policy if exists "letterhead_insert_own" on storage.objects;
create policy "letterhead_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'letterhead' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "letterhead_update_own" on storage.objects;
create policy "letterhead_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'letterhead' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "letterhead_delete_own" on storage.objects;
create policy "letterhead_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'letterhead' and (storage.foldername(name))[1] = auth.uid()::text);
