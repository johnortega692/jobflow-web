-- Allow an existing app admin to grant or revoke app_role = admin on other approved users.

CREATE OR REPLACE FUNCTION public.admin_set_user_app_role(
  target_user_id uuid,
  p_is_admin boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_role text := CASE WHEN p_is_admin THEN 'admin' ELSE 'user' END;
  remaining_admins int;
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own admin access';
  END IF;

  IF NOT p_is_admin THEN
    SELECT count(*)::int
    INTO remaining_admins
    FROM public.profiles
    WHERE app_role = 'admin'
      AND approved_at IS NOT NULL
      AND id <> target_user_id;

    IF remaining_admins < 1 THEN
      RAISE EXCEPTION 'Cannot remove the last admin';
    END IF;
  END IF;

  UPDATE public.profiles
  SET app_role = next_role
  WHERE id = target_user_id
    AND approved_at IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approved user not found';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_user_app_role(uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.admin_set_user_app_role(uuid, boolean) IS
  'Admin-only. Grants or revokes JobFlow app admin on another approved user. Cannot change yourself or remove the last admin.';
