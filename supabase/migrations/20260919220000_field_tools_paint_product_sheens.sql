-- Paint products can list which sheens are available. Empty sheens[] means all catalog sheens.

ALTER TABLE public.field_tools_catalog_items
  ADD COLUMN IF NOT EXISTS sheens text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.field_tools_catalog_items.sheens IS
  'Paint product: allowed sheens. Empty means every catalog sheen is available.';
