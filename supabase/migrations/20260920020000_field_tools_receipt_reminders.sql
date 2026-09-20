alter table public.field_tools_orders
  add column if not exists receipt_reminder_sent_at timestamptz,
  add column if not exists receipt_reminder_count integer not null default 0;

-- Morning Pacific reminder for orders still missing a receipt.
CREATE OR REPLACE FUNCTION public.field_tools_invoke_receipt_reminders()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
DECLARE
  v_secret text;
  v_url text;
  v_anon text;
  v_id bigint;
  v_local timestamp;
BEGIN
  v_local := timezone('America/Los_Angeles', now());
  IF extract(hour FROM v_local)::integer <> 8 THEN
    RETURN 0;
  END IF;

  SELECT s.cron_secret INTO v_secret
  FROM public.field_tools_link_settings s
  WHERE s.id = 1;
  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    RAISE EXCEPTION 'field_tools_link_settings.cron_secret is missing';
  END IF;

  SELECT ds.decrypted_secret INTO v_url
  FROM vault.decrypted_secrets ds
  WHERE ds.name = 'project_url'
  LIMIT 1;
  SELECT ds.decrypted_secret INTO v_anon
  FROM vault.decrypted_secrets ds
  WHERE ds.name = 'publishable_key'
  LIMIT 1;
  IF v_url IS NULL OR btrim(v_url) = '' OR v_anon IS NULL OR btrim(v_anon) = '' THEN
    RAISE EXCEPTION 'vault secrets project_url and publishable_key are required';
  END IF;

  SELECT net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/field-tools-order-receipts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_anon,
      'Authorization', 'Bearer ' || v_anon
    ),
    body := jsonb_build_object('action', 'remind_missing', 'secret', v_secret),
    timeout_milliseconds := 180000
  ) INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.field_tools_invoke_receipt_reminders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.field_tools_invoke_receipt_reminders() TO postgres;

SELECT cron.schedule(
  'field-tools-receipt-reminders-15utc',
  '0 15 * * *',
  $$SELECT public.field_tools_invoke_receipt_reminders()$$
);

SELECT cron.schedule(
  'field-tools-receipt-reminders-16utc',
  '0 16 * * *',
  $$SELECT public.field_tools_invoke_receipt_reminders()$$
);
