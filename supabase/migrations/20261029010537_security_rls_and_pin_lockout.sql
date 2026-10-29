-- Security: drop unused PIN RPCs and require an approved office user
-- on the open policies. field_tools_login_pin is unchanged.

-- ── Legacy login (no callers; replaced by field_tools_login_pin) ────────────

REVOKE EXECUTE ON FUNCTION public.field_tools_list_profiles() FROM PUBLIC, anon, authenticated;
DROP FUNCTION public.field_tools_list_profiles();

REVOKE EXECUTE ON FUNCTION public.field_tools_login(uuid, text) FROM PUBLIC, anon, authenticated;
DROP FUNCTION public.field_tools_login(uuid, text);

-- ── Approved-user policies ──────────────────────────────────────────────────

DROP POLICY IF EXISTS project_paint_estimates_auth_all ON public.project_paint_estimates;
CREATE POLICY project_paint_estimates_auth_all
  ON public.project_paint_estimates
  FOR ALL TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());

DROP POLICY IF EXISTS project_approved_brushouts_auth_all ON public.project_approved_brushouts;
CREATE POLICY project_approved_brushouts_auth_all
  ON public.project_approved_brushouts
  FOR ALL TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());

DROP POLICY IF EXISTS jobflow_material_order_pos_authenticated_all ON public.jobflow_material_order_pos;
CREATE POLICY jobflow_material_order_pos_authenticated_all
  ON public.jobflow_material_order_pos
  FOR ALL TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());

DROP POLICY IF EXISTS field_tools_order_dispatches_authenticated_tracking ON public.field_tools_order_dispatches;
CREATE POLICY field_tools_order_dispatches_authenticated_tracking
  ON public.field_tools_order_dispatches
  FOR UPDATE TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());

DROP POLICY IF EXISTS "sds_files_authenticated_all" ON storage.objects;
CREATE POLICY "sds_files_authenticated_all" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'sds-files' AND public.is_approved_user())
  WITH CHECK (bucket_id = 'sds-files' AND public.is_approved_user());

DROP POLICY IF EXISTS "work_orders_storage_authenticated_all" ON storage.objects;
CREATE POLICY "work_orders_storage_authenticated_all" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'work-orders' AND public.is_approved_user())
  WITH CHECK (bucket_id = 'work-orders' AND public.is_approved_user());

DROP POLICY IF EXISTS "rfi_files_authenticated_all" ON storage.objects;
CREATE POLICY "rfi_files_authenticated_all" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'rfi-files' AND public.is_approved_user())
  WITH CHECK (bucket_id = 'rfi-files' AND public.is_approved_user());

DROP POLICY IF EXISTS field_tools_receipts_authenticated_read ON storage.objects;
CREATE POLICY field_tools_receipts_authenticated_read
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'field-tools-receipts'
    AND public.is_approved_user()
    AND EXISTS (
      SELECT 1
      FROM public.field_tools_order_receipts r
      JOIN public.field_tools_orders o ON o.id = r.order_id
      WHERE r.storage_path = name
        AND NOT public.field_tools_job_number_hidden(o.job_number)
    )
  );

DROP POLICY IF EXISTS field_tools_order_receipts_authenticated_read ON public.field_tools_order_receipts;
CREATE POLICY field_tools_order_receipts_authenticated_read
  ON public.field_tools_order_receipts
  FOR SELECT TO authenticated
  USING (
    public.is_approved_user()
    AND EXISTS (
      SELECT 1
      FROM public.field_tools_orders o
      WHERE o.id = order_id
        AND NOT public.field_tools_job_number_hidden(o.job_number)
    )
  );

-- ── Anonymous catalog reads ─────────────────────────────────────────────────
-- Office and Field Tools read these through security-definer RPCs that call
-- field_tools_require_session or field_tools_require_strict_admin.
-- Those functions bypass RLS. Direct table selects stop.

DROP POLICY IF EXISTS field_tools_scope_library_anon_read ON public.field_tools_scope_library;
DROP POLICY IF EXISTS field_tools_crew_kits_anon_read ON public.field_tools_crew_kits;
DROP POLICY IF EXISTS field_tools_sundry_packages_anon_read ON public.field_tools_sundry_packages;
DROP POLICY IF EXISTS field_tools_scope_materials_anon_read ON public.field_tools_scope_materials;
DROP POLICY IF EXISTS field_tools_crew_kit_items_anon_read ON public.field_tools_crew_kit_items;

NOTIFY pgrst, 'reload schema';
