-- Field view: supers access /field without signing in (anon Supabase role).

drop policy if exists "projects_select_anon" on public.projects;
create policy "projects_select_anon" on public.projects
  for select to anon using (true);

drop policy if exists "projects_update_anon" on public.projects;
create policy "projects_update_anon" on public.projects
  for update to anon using (true) with check (true);

drop policy if exists "project_activity_insert_anon" on public.project_activity;
create policy "project_activity_insert_anon" on public.project_activity
  for insert to anon with check (true);

drop policy if exists "org_settings_select_anon" on public.org_settings;
create policy "org_settings_select_anon" on public.org_settings
  for select to anon using (true);
