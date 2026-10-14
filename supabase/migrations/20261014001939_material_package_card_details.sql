-- Public package page reads the live tracker line, including dates, status, and notes.

create or replace function public.material_package_card(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'job_number', coalesce(nullif(btrim(p.data->'job_info'->>'wc_job_number'), ''), p.job_number, ''),
    'job_name', coalesce(nullif(btrim(p.data->'job_info'->>'wc_job_name'), ''), p.job_name, ''),
    'label', coalesce(line->>'label', ''),
    'material_name', coalesce(line->>'wallcoveringName', ''),
    'manufacturer', coalesce(line->>'manufacturer', ''),
    'product', coalesce(line->>'product', ''),
    'color', coalesce(line->>'color', ''),
    'package_qty', coalesce(line->>'packageQty', ''),
    'order_qty', coalesce(line->>'orderQty', ''),
    'order_unit', coalesce(line->>'orderUnit', ''),
    'order_notes', coalesce(line->>'orderNotes', ''),
    'lead_time', coalesce(line->>'leadTime', ''),
    'approval_received', coalesce(line->>'approvalReceived', ''),
    'date_ordered', coalesce(line->>'dateOrdered', ''),
    'ship_date', coalesce(line->>'shipDate', ''),
    'install_date', coalesce(line->>'installDate', ''),
    'follow_up', coalesce(line->>'followUp', ''),
    'esd_follow_up', coalesce(line->>'esdFollowUp', ''),
    'tracking', coalesce(line->>'tracking', ''),
    'delivery_notes', coalesce(line->>'notesDelivered', ''),
    'revision_notes', coalesce(line->>'revisionNotes', ''),
    'image_url', coalesce(line->>'imageUrl', ''),
    'document_url', coalesce(line->>'dropbox', ''),
    'ordered', coalesce(line->>'ordered', '') = 'true',
    'sent_for_approval', coalesce(line->>'sentForApproval', '') = 'true',
    'revision', coalesce(line->>'revision', '') = 'true',
    'approved', coalesce(line->>'approved', '') = 'true',
    'field_measure', coalesce(line->>'fieldMeasurement', '') = 'true',
    'shops', coalesce(line->>'shops', '') = 'true',
    'panels', coalesce(line->>'panels', '') = 'true',
    'material_order', coalesce(line->>'materialOrder', '') = 'true',
    'delivered', coalesce(line->>'delivered', '') = 'true'
  )
  from public.projects p
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(p.data->'wc_tracker_lines') = 'array' then p.data->'wc_tracker_lines'
      else '[]'::jsonb
    end
  ) as line
  where char_length(btrim(coalesce(p_token, ''))) >= 8
    and line->>'shareToken' = btrim(p_token)
  limit 1;
$$;

revoke all on function public.material_package_card(text) from public;
grant execute on function public.material_package_card(text) to anon, authenticated;
