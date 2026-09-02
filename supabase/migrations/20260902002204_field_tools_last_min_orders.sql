-- Last-Min walk-in orders: same PO sequence as paint, no vendor email.

alter table public.field_tools_orders
  drop constraint if exists field_tools_orders_order_type_check;

alter table public.field_tools_orders
  add constraint field_tools_orders_order_type_check
  check (order_type = any (array['field_request'::text, 'job_scope_kit'::text, 'last_min'::text]));

alter table public.field_tools_order_dispatches
  drop constraint if exists field_tools_order_dispatches_dispatch_type_check;

alter table public.field_tools_order_dispatches
  add constraint field_tools_order_dispatches_dispatch_type_check
  check (dispatch_type = any (array[
    'material'::text,
    'rental'::text,
    'equipment'::text,
    'wallcovering'::text,
    'haul_off'::text,
    'job_scope_kit'::text,
    'last_min'::text
  ]));
