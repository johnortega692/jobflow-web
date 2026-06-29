-- JobFlow PO tracker: office checkboxes on Field Tools dispatches with PO numbers

ALTER TABLE public.field_tools_order_dispatches
  ADD COLUMN IF NOT EXISTS received_field boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tracking_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS field_tools_order_dispatches_po_idx
  ON public.field_tools_order_dispatches (po_number)
  WHERE po_number <> '';

-- JobFlow (authenticated) can read PO dispatches and update tracking flags
DROP POLICY IF EXISTS field_tools_order_dispatches_authenticated_read ON public.field_tools_order_dispatches;
CREATE POLICY field_tools_order_dispatches_authenticated_read ON public.field_tools_order_dispatches
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS field_tools_order_dispatches_authenticated_tracking ON public.field_tools_order_dispatches;
CREATE POLICY field_tools_order_dispatches_authenticated_tracking ON public.field_tools_order_dispatches
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS field_tools_orders_authenticated_read ON public.field_tools_orders;
CREATE POLICY field_tools_orders_authenticated_read ON public.field_tools_orders
  FOR SELECT TO authenticated USING (true);

NOTIFY pgrst, 'reload schema';
