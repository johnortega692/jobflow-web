-- Expand org_settings with shared company settings blob (letterhead, vendors, paint, work orders, etc.)

alter table public.org_settings
  add column if not exists settings jsonb not null default '{}'::jsonb;

-- Seed shared settings from admin account (exclude per-user keys).
update public.org_settings os
set
  settings = (
    select coalesce(u.settings, '{}'::jsonb)
      - 'signer_name'
      - 'signer_title'
      - 'signer_phone'
      - 'signer_email'
      - 'user_name'
      - 'brushout_preps'
      - 'work_order_display'
      - 'work_order_scan_boxes'
      - 'work_order_total_positions'
      - 'work_order_text_spacing'
      - 'google_urls'
    from public.user_settings u
    join auth.users a on a.id = u.user_id
    where lower(a.email) = 'johnortega@gmail.com'
    limit 1
  ),
  updated_by = (
    select u.user_id
    from public.user_settings u
    join auth.users a on a.id = u.user_id
    where lower(a.email) = 'johnortega@gmail.com'
    limit 1
  ),
  updated_at = now()
where os.id = 1
  and (
    os.settings = '{}'::jsonb
    or os.settings is null
  )
  and exists (
    select 1
    from public.user_settings u
    join auth.users a on a.id = u.user_id
    where lower(a.email) = 'johnortega@gmail.com'
  );
