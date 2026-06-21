-- RFI attachment uploads (PDF / images appended when exporting the RFI PDF)

insert into storage.buckets (id, name, public)
values ('rfi-files', 'rfi-files', false)
on conflict (id) do nothing;

drop policy if exists "rfi_files_authenticated_all" on storage.objects;
create policy "rfi_files_authenticated_all" on storage.objects
  for all to authenticated
  using (bucket_id = 'rfi-files')
  with check (bucket_id = 'rfi-files');
