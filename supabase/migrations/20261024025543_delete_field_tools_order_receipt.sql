-- JobFlow admins can delete one Field Tools receipt photo (file + row).

create or replace function public.delete_field_tools_order_receipt(p_receipt_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text;
begin
  if not public.is_app_admin() then
    raise exception 'Admin required';
  end if;

  if p_receipt_id is null then
    raise exception 'Receipt id required';
  end if;

  select r.storage_path
  into v_path
  from public.field_tools_order_receipts r
  where r.id = p_receipt_id;

  if v_path is null then
    raise exception 'Receipt not found';
  end if;

  perform set_config('storage.allow_delete_query', 'true', true);

  delete from storage.objects obj
  where obj.bucket_id = 'field-tools-receipts'
    and obj.name = v_path;

  delete from public.field_tools_order_receipts
  where id = p_receipt_id;
end;
$$;

revoke all on function public.delete_field_tools_order_receipt(uuid) from public;
revoke all on function public.delete_field_tools_order_receipt(uuid) from anon;
grant execute on function public.delete_field_tools_order_receipt(uuid) to authenticated;

notify pgrst, 'reload schema';
