-- JobFlow admins can read and set the shared Field Tools PO sequence for a job.

create or replace function public.jobflow_get_po_sequence(p_job_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  clean text;
  digits integer;
  highest integer;
  admin_next integer;
  seq integer;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'Sign in required.');
  end if;

  clean := public.field_tools_po_normalize_job_code(p_job_code);
  if clean = 'JOB' then
    return jsonb_build_object('ok', false, 'error', 'Job code is required.');
  end if;

  select coalesce(s.po_seq_digits, 3) into digits
  from public.field_tools_order_settings s
  where s.id = 1;
  if digits is null then
    digits := 3;
  end if;

  highest := public.field_tools_po_highest_issued(clean);

  select j.next_seq into admin_next
  from public.field_tools_po_job_sequences j
  where j.job_code = clean;

  seq := coalesce(admin_next, highest + 1);

  return jsonb_build_object(
    'ok', true,
    'job_code', clean,
    'highest_issued', highest,
    'next_seq', seq,
    'has_override', admin_next is not null,
    'digits', digits,
    'next_po', clean || '-' || lpad(seq::text, digits, '0')
  );
end;
$$;

create or replace function public.jobflow_set_po_sequence(p_job_code text, p_next_seq integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text;
  digits integer;
begin
  if not public.is_app_admin() then
    return jsonb_build_object('ok', false, 'error', 'Only an admin can change the PO sequence.');
  end if;

  clean := public.field_tools_po_normalize_job_code(p_job_code);
  if clean = 'JOB' then
    return jsonb_build_object('ok', false, 'error', 'Job code is required.');
  end if;

  if p_next_seq is null or p_next_seq < 1 then
    return jsonb_build_object('ok', false, 'error', 'Next sequence must be at least 1.');
  end if;

  if p_next_seq <= public.field_tools_po_highest_issued(clean) then
    return jsonb_build_object(
      'ok', false,
      'error',
      format(
        'Next sequence must be greater than the highest issued (%s).',
        public.field_tools_po_highest_issued(clean)
      )
    );
  end if;

  insert into public.field_tools_po_job_sequences (job_code, next_seq, updated_at)
  values (clean, p_next_seq, now())
  on conflict (job_code) do update set
    next_seq = excluded.next_seq,
    updated_at = now();

  select coalesce(s.po_seq_digits, 3) into digits
  from public.field_tools_order_settings s
  where s.id = 1;
  if digits is null then
    digits := 3;
  end if;

  return jsonb_build_object(
    'ok', true,
    'job_code', clean,
    'next_seq', p_next_seq,
    'next_po', clean || '-' || lpad(p_next_seq::text, digits, '0')
  );
end;
$$;

create or replace function public.jobflow_clear_po_sequence(p_job_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text;
begin
  if not public.is_app_admin() then
    return jsonb_build_object('ok', false, 'error', 'Only an admin can change the PO sequence.');
  end if;

  clean := public.field_tools_po_normalize_job_code(p_job_code);
  delete from public.field_tools_po_job_sequences where job_code = clean;
  return jsonb_build_object('ok', true, 'job_code', clean);
end;
$$;

revoke all on function public.jobflow_get_po_sequence(text) from public, anon;
revoke all on function public.jobflow_set_po_sequence(text, integer) from public, anon;
revoke all on function public.jobflow_clear_po_sequence(text) from public, anon;
grant execute on function public.jobflow_get_po_sequence(text) to authenticated;
grant execute on function public.jobflow_set_po_sequence(text, integer) to authenticated;
grant execute on function public.jobflow_clear_po_sequence(text) to authenticated;
