-- Allow a general AHA scope, and record Cal/OSHA vs EM 385 on each job AHA.

do $$
declare
  r record;
begin
  for r in
    select nsp.nspname, rel.relname, con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname in ('aha_library', 'project_ahas')
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%scope%'
  loop
    execute format('alter table %I.%I drop constraint %I', r.nspname, r.relname, r.conname);
  end loop;
end $$;

alter table public.aha_library
  add constraint aha_library_scope_check
  check (scope in ('paint', 'wallcovering', 'access', 'general'));

alter table public.project_ahas
  add constraint project_ahas_scope_check
  check (scope in ('paint', 'wallcovering', 'access', 'general'));

update public.project_ahas
set options = coalesce(options, '{}'::jsonb) || '{"standard":"em385"}'::jsonb
where coalesce(options->>'standard', '') not in ('em385', 'calosha');

alter table public.project_ahas
  alter column options set default '{"spanish":false,"matrix":true,"standard":"calosha"}'::jsonb;
