-- JobFlow office users can view Last-Min receipt photos already stored for a job.
-- Same visibility as PO order history: authenticated, and not a hidden Field Tools job.

grant select on table public.field_tools_order_receipts to authenticated;

drop policy if exists field_tools_order_receipts_authenticated_read on public.field_tools_order_receipts;
create policy field_tools_order_receipts_authenticated_read
  on public.field_tools_order_receipts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.field_tools_orders o
      where o.id = order_id
        and not public.field_tools_job_number_hidden(o.job_number)
    )
  );

drop policy if exists field_tools_receipts_authenticated_read on storage.objects;
create policy field_tools_receipts_authenticated_read
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'field-tools-receipts'
    and exists (
      select 1
      from public.field_tools_order_receipts r
      join public.field_tools_orders o on o.id = r.order_id
      where r.storage_path = name
        and not public.field_tools_job_number_hidden(o.job_number)
    )
  );
