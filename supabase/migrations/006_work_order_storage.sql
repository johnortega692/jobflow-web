-- Work order source PDFs / images (per-user paths under bucket)

insert into storage.buckets (id, name, public)
values ('work-orders', 'work-orders', false)
on conflict (id) do nothing;

drop policy if exists "work_orders_storage_authenticated_all" on storage.objects;
create policy "work_orders_storage_authenticated_all" on storage.objects
  for all to authenticated
  using (bucket_id = 'work-orders')
  with check (bucket_id = 'work-orders');
