-- Project managers may set the shared PO sequence from JobFlow, same as app admins.

create or replace function public.jobflow_can_adjust_po_sequence()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_app_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.approved_at is not null
        and lower(trim(coalesce(p.job_role, ''))) = 'pm'
    );
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
  if not public.jobflow_can_adjust_po_sequence() then
    return jsonb_build_object('ok', false, 'error', 'Only an admin or project manager can change the PO sequence.');
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
  if not public.jobflow_can_adjust_po_sequence() then
    return jsonb_build_object('ok', false, 'error', 'Only an admin or project manager can change the PO sequence.');
  end if;

  clean := public.field_tools_po_normalize_job_code(p_job_code);
  delete from public.field_tools_po_job_sequences where job_code = clean;
  return jsonb_build_object('ok', true, 'job_code', clean);
end;
$$;

revoke all on function public.jobflow_can_adjust_po_sequence() from public, anon, authenticated;
revoke all on function public.jobflow_set_po_sequence(text, integer) from public, anon;
revoke all on function public.jobflow_clear_po_sequence(text) from public, anon;
grant execute on function public.jobflow_set_po_sequence(text, integer) to authenticated;
grant execute on function public.jobflow_clear_po_sequence(text) to authenticated;
