-- JobFlow admins can read and change the sales tax used on material orders.

create or replace function public.jobflow_admin_material_tax(p_tax_percent numeric default null)
returns jsonb
language plpgsql
security definer
set search_path to public
as $$
declare
  v_tax numeric;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.app_role = 'admin'
  ) then
    return jsonb_build_object('ok', false, 'error', 'Admin access required');
  end if;

  if p_tax_percent is not null then
    if p_tax_percent < 0 or p_tax_percent > 25 then
      return jsonb_build_object('ok', false, 'error', 'Sales tax must be between 0 and 25 percent.');
    end if;
    v_tax := round(p_tax_percent, 2);
    update public.field_tools_material_report_settings
    set tax_percent = v_tax, updated_at = now()
    where id = 1;
    if not found then
      insert into public.field_tools_material_report_settings (id, tax_percent)
      values (1, v_tax);
    end if;
  end if;

  select coalesce(s.tax_percent, 10.25) into v_tax
  from public.field_tools_material_report_settings s
  where s.id = 1;
  return jsonb_build_object('ok', true, 'tax_percent', coalesce(v_tax, 10.25));
end;
$$;

revoke all on function public.jobflow_admin_material_tax(numeric) from public, anon;
grant execute on function public.jobflow_admin_material_tax(numeric) to authenticated;

notify pgrst, 'reload schema';
