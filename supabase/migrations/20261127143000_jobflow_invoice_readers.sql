-- Vendors added from Settings → Read invoices. Built-in readers stay in the app.

create table public.jobflow_invoice_readers (
  id text primary key,
  vendor_name text not null,
  catalog boolean not null default false,
  created_at timestamptz not null default now(),
  constraint jobflow_invoice_readers_id_check check (id ~ '^custom-[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint jobflow_invoice_readers_name_check check (char_length(btrim(vendor_name)) between 2 and 80)
);

alter table public.jobflow_invoice_readers enable row level security;

create policy jobflow_invoice_readers_select
  on public.jobflow_invoice_readers
  for select
  to authenticated
  using (true);

revoke all on table public.jobflow_invoice_readers from public, anon;
grant select on table public.jobflow_invoice_readers to authenticated;

create or replace function public.jobflow_list_invoice_readers()
returns jsonb
language sql
stable
security invoker
set search_path to public
as $$
  select jsonb_build_object(
    'ok', true,
    'readers', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', r.id,
            'vendorName', r.vendor_name,
            'catalog', r.catalog
          )
          order by r.vendor_name
        )
        from public.jobflow_invoice_readers r
      ),
      '[]'::jsonb
    )
  );
$$;

create or replace function public.jobflow_admin_save_invoice_reader(p_vendor_name text, p_catalog boolean)
returns jsonb
language plpgsql
security definer
set search_path to public
as $$
declare
  v_name text := btrim(coalesce(p_vendor_name, ''));
  v_slug text;
  v_id text;
  v_key text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.app_role = 'admin'
  ) then
    return jsonb_build_object('ok', false, 'error', 'Admin access required');
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    return jsonb_build_object('ok', false, 'error', 'Enter a vendor name.');
  end if;
  v_slug := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
  if v_slug = '' then
    return jsonb_build_object('ok', false, 'error', 'Use a vendor name with letters or numbers.');
  end if;
  v_key := regexp_replace(lower(v_name), '[^a-z0-9]', '', 'g');
  if v_key in (
    'sherwinwilliams',
    'dunnedwards',
    'ppg',
    'ppgpaints',
    'benjaminmoore',
    'sunbeltrentals',
    'wolfgordon'
  ) then
    return jsonb_build_object('ok', false, 'error', 'That vendor already has a reader.');
  end if;
  v_id := 'custom-' || v_slug;
  insert into public.jobflow_invoice_readers (id, vendor_name, catalog)
  values (v_id, v_name, coalesce(p_catalog, false))
  on conflict (id) do update
    set vendor_name = excluded.vendor_name,
        catalog = excluded.catalog;
  return jsonb_build_object(
    'ok', true,
    'reader', jsonb_build_object('id', v_id, 'vendorName', v_name, 'catalog', coalesce(p_catalog, false))
  );
end;
$$;

create or replace function public.jobflow_admin_delete_invoice_reader(p_id text)
returns jsonb
language plpgsql
security definer
set search_path to public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.app_role = 'admin'
  ) then
    return jsonb_build_object('ok', false, 'error', 'Admin access required');
  end if;
  if coalesce(p_id, '') !~ '^custom-[a-z0-9]+(-[a-z0-9]+)*$' then
    return jsonb_build_object('ok', false, 'error', 'That vendor cannot be removed.');
  end if;
  delete from public.jobflow_invoice_readers where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.jobflow_list_invoice_readers() from public, anon;
revoke all on function public.jobflow_admin_save_invoice_reader(text, boolean) from public, anon;
revoke all on function public.jobflow_admin_delete_invoice_reader(text) from public, anon;
grant execute on function public.jobflow_list_invoice_readers() to authenticated;
grant execute on function public.jobflow_admin_save_invoice_reader(text, boolean) to authenticated;
grant execute on function public.jobflow_admin_delete_invoice_reader(text) to authenticated;
