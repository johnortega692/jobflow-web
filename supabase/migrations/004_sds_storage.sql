-- SDS/TDS manufacturer PDF uploads (merged into packet in the browser)

insert into storage.buckets (id, name, public)
values ('sds-files', 'sds-files', false)
on conflict (id) do nothing;

drop policy if exists "sds_files_authenticated_all" on storage.objects;
create policy "sds_files_authenticated_all" on storage.objects
  for all to authenticated
  using (bucket_id = 'sds-files')
  with check (bucket_id = 'sds-files');
