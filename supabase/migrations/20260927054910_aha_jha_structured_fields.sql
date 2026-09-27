-- Company JHA fields: considerations, paired equipment rows, competent persons, and review header.

alter table public.aha_library
  add column if not exists considerations jsonb not null default '[]'::jsonb,
  add column if not exists equipment_rows jsonb not null default '[]'::jsonb,
  add column if not exists competent_persons jsonb not null default '[]'::jsonb;

alter table public.project_ahas
  add column if not exists considerations jsonb not null default '[]'::jsonb,
  add column if not exists equipment_rows jsonb not null default '[]'::jsonb,
  add column if not exists competent_persons jsonb not null default '[]'::jsonb,
  add column if not exists project_manager text not null default '',
  add column if not exists superintendent text not null default '',
  add column if not exists foreman text not null default '',
  add column if not exists reviewed_by text not null default '',
  add column if not exists notes text not null default '',
  add column if not exists review_log jsonb not null default '[]'::jsonb;

-- Pair the old text[] columns by index, then drop them. Leftover training or inspection
-- rows are stored with equipment "General". Safe to re-run after the columns are gone.
do $$
declare
  rec record;
  n int;
  i int;
  built jsonb;
  equip text;
  train text;
  insp text;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'aha_library'
      and column_name = 'equipment'
  ) then
    for rec in
      select
        id,
        coalesce(equipment, '{}'::text[]) as equipment,
        coalesce(training, '{}'::text[]) as training,
        coalesce(inspection, '{}'::text[]) as inspection
      from public.aha_library
    loop
      n := greatest(cardinality(rec.equipment), cardinality(rec.training), cardinality(rec.inspection));
      built := '[]'::jsonb;
      for i in 1..n loop
        if i <= cardinality(rec.equipment) then
          equip := coalesce(rec.equipment[i], '');
        else
          equip := 'General';
        end if;
        if i <= cardinality(rec.training) then
          train := coalesce(rec.training[i], '');
        else
          train := '';
        end if;
        if i <= cardinality(rec.inspection) then
          insp := coalesce(rec.inspection[i], '');
        else
          insp := '';
        end if;
        built := built || jsonb_build_array(jsonb_build_object(
          'id', gen_random_uuid(),
          'equipment', equip,
          'training', train,
          'inspection', insp
        ));
      end loop;
      update public.aha_library set equipment_rows = built where id = rec.id;
    end loop;

    alter table public.aha_library
      drop column equipment,
      drop column training,
      drop column inspection;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'project_ahas'
      and column_name = 'equipment'
  ) then
    for rec in
      select
        id,
        coalesce(equipment, '{}'::text[]) as equipment,
        coalesce(training, '{}'::text[]) as training,
        coalesce(inspection, '{}'::text[]) as inspection
      from public.project_ahas
    loop
      n := greatest(cardinality(rec.equipment), cardinality(rec.training), cardinality(rec.inspection));
      built := '[]'::jsonb;
      for i in 1..n loop
        if i <= cardinality(rec.equipment) then
          equip := coalesce(rec.equipment[i], '');
        else
          equip := 'General';
        end if;
        if i <= cardinality(rec.training) then
          train := coalesce(rec.training[i], '');
        else
          train := '';
        end if;
        if i <= cardinality(rec.inspection) then
          insp := coalesce(rec.inspection[i], '');
        else
          insp := '';
        end if;
        built := built || jsonb_build_array(jsonb_build_object(
          'id', gen_random_uuid(),
          'equipment', equip,
          'training', train,
          'inspection', insp
        ));
      end loop;
      update public.project_ahas set equipment_rows = built where id = rec.id;
    end loop;

    alter table public.project_ahas
      drop column equipment,
      drop column training,
      drop column inspection;
  end if;
end $$;
