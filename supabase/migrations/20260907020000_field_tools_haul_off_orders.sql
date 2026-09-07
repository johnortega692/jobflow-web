-- Standalone Haul Out orders use order_type = haul_off (dispatch type already existed).

alter table public.field_tools_orders
  drop constraint if exists field_tools_orders_order_type_check;

alter table public.field_tools_orders
  add constraint field_tools_orders_order_type_check
  check (order_type = any (array[
    'field_request'::text,
    'job_scope_kit'::text,
    'last_min'::text,
    'haul_off'::text
  ]));
