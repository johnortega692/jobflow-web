-- Admin "update open apps" stamp. Clients compare it on resume; a realtime
-- broadcast tells phones that are already open.

alter table public.field_tools_order_settings
  add column if not exists force_app_update_at timestamptz;

create or replace function public.field_tools_app_update_at()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select s.force_app_update_at
  from public.field_tools_order_settings s
  where s.id = 1;
$$;

grant execute on function public.field_tools_app_update_at() to anon, authenticated;

create or replace function public.field_tools_admin_force_app_update(
  p_caller_id uuid,
  p_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  stamped timestamptz := now();
begin
  perform public.field_tools_require_admin(p_caller_id, p_session_token);

  update public.field_tools_order_settings
  set force_app_update_at = stamped
  where id = 1;

  return jsonb_build_object('ok', true, 'force_app_update_at', stamped);
end;
$$;

grant execute on function public.field_tools_admin_force_app_update(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
