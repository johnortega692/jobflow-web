-- Allow paint attic-stock orders to share the material PO log.

ALTER TABLE public.jobflow_material_order_pos
  DROP CONSTRAINT IF EXISTS jobflow_material_order_pos_scope_check;

ALTER TABLE public.jobflow_material_order_pos
  ADD CONSTRAINT jobflow_material_order_pos_scope_check
  CHECK (scope IN ('wallcovering', 'frp', 'fwp', 'paint'));
