-- Paper receipt dropped off at the office: counts as the order's receipt in reminders and Order History.

ALTER TABLE public.field_tools_orders
  ADD COLUMN IF NOT EXISTS paper_receipt_at timestamptz,
  ADD COLUMN IF NOT EXISTS paper_receipt_by text;

CREATE OR REPLACE FUNCTION public.jobflow_set_order_paper_receipt(p_order_id uuid, p_on_file boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_name text;
  v_at timestamptz;
begin
  if auth.uid() is null or not public.is_approved_user(auth.uid()) then
    raise exception 'Not allowed';
  end if;
  if p_order_id is null then
    raise exception 'Order id required';
  end if;

  if coalesce(p_on_file, false) then
    select coalesce(nullif(trim(p.display_name), ''), auth.email(), 'JobFlow')
    into v_name
    from (select 1) one
    left join public.profiles p on p.id = auth.uid();
    v_at := now();
  end if;

  update public.field_tools_orders
  set paper_receipt_at = v_at,
      paper_receipt_by = v_name
  where id = p_order_id;

  if not found then
    raise exception 'Order not found';
  end if;

  return jsonb_build_object('ok', true, 'paper_receipt_at', v_at, 'paper_receipt_by', v_name);
end;
$$;

REVOKE ALL ON FUNCTION public.jobflow_set_order_paper_receipt(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.jobflow_set_order_paper_receipt(uuid, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
