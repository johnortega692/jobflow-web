-- Allow admins to upload shared org letterhead logo under org/

drop policy if exists "letterhead_insert_org" on storage.objects;
create policy "letterhead_insert_org" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'letterhead'
    and (storage.foldername(name))[1] = 'org'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.app_role = 'admin'
    )
  );

drop policy if exists "letterhead_update_org" on storage.objects;
create policy "letterhead_update_org" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'letterhead'
    and (storage.foldername(name))[1] = 'org'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.app_role = 'admin'
    )
  );

drop policy if exists "letterhead_delete_org" on storage.objects;
create policy "letterhead_delete_org" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'letterhead'
    and (storage.foldername(name))[1] = 'org'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.app_role = 'admin'
    )
  );
