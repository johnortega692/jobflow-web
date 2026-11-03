-- Sunday night: log the finished week's crew schedule to the Hours Tracker on the server.
-- Same rules as "Log week from schedule" in Manpower (buildJobReport / buildTrainingWeekLog):
-- full day or night shift = 8 hrs, each half of an AM / PM split = 4 hrs, walks count nothing,
-- training goes to the training log (office or for a project), only active crew and visible jobs count.

create or replace function manpower_api.training_target(p_part text)
returns text
language plpgsql
immutable
as $$
declare
  v_val text := btrim(coalesce(p_part, ''));
  v_name text := manpower_api.training_job_name();
  v_suffix text;
  v_project text;
begin
  if lower(left(v_val, length(v_name))) <> lower(v_name) then
    return null;
  end if;
  v_suffix := substr(v_val, length(v_name) + 1);
  if v_suffix = '' or v_suffix = '|office' then
    return '';
  end if;
  if left(v_suffix, 5) = '|for:' then
    v_project := btrim(substr(v_suffix, 6));
    return v_project;
  end if;
  return '';
end;
$$;

comment on function manpower_api.training_target(text) is
  'Null when the cell part is not training. Empty string for office training, otherwise the project job name.';

create or replace function manpower_api.compute_week_hours(p_week_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, manpower_api
as $$
declare
  v_jobs jsonb := '{}'::jsonb;
  v_office numeric := 0;
  v_by_project jsonb := '{}'::jsonb;
  rec record;
  v_val text;
  v_match text[];
  v_part text;
  v_target text;
  v_parts text[];
begin
  select coalesce(jsonb_object_agg(j.name, 0), '{}'::jsonb)
  into v_jobs
  from public.manpower_jobs j
  where j.week_id = p_week_id
    and manpower_api.job_is_visible(j.project_id, j.name)
    and lower(btrim(j.name)) <> lower(manpower_api.training_job_name());

  for rec in
    select btrim(a.cell_value) as val
    from public.manpower_assignments a
    join public.manpower_employees e on e.id = a.employee_id and e.active
    where a.week_id = p_week_id
      and a.day_key in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')
      and btrim(coalesce(a.cell_value, '')) <> ''
  loop
    v_val := rec.val;

    if v_val ~* '^walk:' then
      continue;
    end if;

    v_target := manpower_api.training_target(v_val);
    if v_target is not null then
      if v_target = '' then
        v_office := v_office + 8;
      else
        v_by_project := jsonb_set(v_by_project, array[v_target], to_jsonb(coalesce((v_by_project->>v_target)::numeric, 0) + 8));
      end if;
      continue;
    end if;

    v_match := regexp_match(v_val, '^night:\s*(.+)$', 'i');
    if v_match is not null then
      v_part := btrim(v_match[1]);
      v_target := manpower_api.training_target(v_part);
      if v_target is not null then
        if v_target = '' then
          v_office := v_office + 8;
        else
          v_by_project := jsonb_set(v_by_project, array[v_target], to_jsonb(coalesce((v_by_project->>v_target)::numeric, 0) + 8));
        end if;
      elsif jsonb_exists(v_jobs, v_part) then
        v_jobs := jsonb_set(v_jobs, array[v_part], to_jsonb((v_jobs->>v_part)::numeric + 8));
      end if;
      continue;
    end if;

    if position(' / ' in v_val) > 0 then
      v_parts := array[split_part(v_val, '/', 1), split_part(v_val, '/', 2)];
      foreach v_part in array v_parts
      loop
        v_part := btrim(regexp_replace(btrim(v_part), '^(AM|PM):\s*', '', 'i'));
        v_target := manpower_api.training_target(v_part);
        if v_target is not null then
          if v_target = '' then
            v_office := v_office + 4;
          else
            v_by_project := jsonb_set(v_by_project, array[v_target], to_jsonb(coalesce((v_by_project->>v_target)::numeric, 0) + 4));
          end if;
        elsif v_part <> '' and v_part <> 'None' and jsonb_exists(v_jobs, v_part) then
          v_jobs := jsonb_set(v_jobs, array[v_part], to_jsonb((v_jobs->>v_part)::numeric + 4));
        end if;
      end loop;
      continue;
    end if;

    if jsonb_exists(v_jobs, v_val) then
      v_jobs := jsonb_set(v_jobs, array[v_val], to_jsonb((v_jobs->>v_val)::numeric + 8));
    end if;
  end loop;

  return jsonb_build_object(
    'jobs', v_jobs,
    'training', jsonb_build_object('office', v_office, 'by_project', v_by_project)
  );
end;
$$;

-- Writes the same rows as the Log week button: jobs with hours > 0 get week_hours[key], and the
-- training row gets training_log[key]. p_dry_run returns the numbers without writing.
create or replace function manpower_api.auto_log_week_hours(p_week_start date, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  v_week public.manpower_weeks;
  v_key text;
  v_hours jsonb;
  v_job text;
  v_value numeric;
  v_logged int := 0;
begin
  select * into v_week from public.manpower_weeks where week_start = p_week_start;
  if v_week.id is null then
    return jsonb_build_object('ok', false, 'week_start', p_week_start, 'message', 'No schedule week');
  end if;

  v_key := to_char(v_week.week_start, 'YYYY-MM-DD');
  v_hours := manpower_api.compute_week_hours(v_week.id);

  if p_dry_run then
    return jsonb_build_object('ok', true, 'dry_run', true, 'week', v_key, 'hours', v_hours);
  end if;

  for v_job, v_value in
    select key, value::numeric from jsonb_each_text(v_hours->'jobs')
  loop
    if v_value <= 0 then
      continue;
    end if;
    insert into public.manpower_hours_jobs (job_name, week_hours, updated_at)
    values (btrim(v_job), jsonb_build_object(v_key, v_value), now())
    on conflict (job_name) do update set
      week_hours = public.manpower_hours_jobs.week_hours || jsonb_build_object(v_key, v_value),
      updated_at = now();
    v_logged := v_logged + 1;
  end loop;

  perform manpower_api.ensure_training_hours_row();
  update public.manpower_hours_jobs
  set training_log = training_log || jsonb_build_object(v_key, v_hours->'training'),
      updated_at = now()
  where job_name = manpower_api.training_job_name();

  return jsonb_build_object('ok', true, 'week', v_key, 'jobs_logged', v_logged, 'training', v_hours->'training');
end;
$$;

-- Runs from pg_cron at 06:00 and 07:00 UTC on Monday so one of them lands on Sunday 11 PM Pacific.
create or replace function public.manpower_invoke_sunday_hours_log()
returns jsonb
language plpgsql
security definer
set search_path = public, manpower_api
as $$
declare
  v_local timestamp := timezone('America/Los_Angeles', now());
begin
  if extract(isodow from v_local)::int <> 7 or extract(hour from v_local)::int <> 23 then
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;
  return manpower_api.auto_log_week_hours(manpower_api.monday_on(v_local::date));
end;
$$;

revoke all on function manpower_api.training_target(text) from public, anon, authenticated;
revoke all on function manpower_api.compute_week_hours(uuid) from public, anon, authenticated;
revoke all on function manpower_api.auto_log_week_hours(date, boolean) from public, anon, authenticated;
revoke all on function public.manpower_invoke_sunday_hours_log() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('manpower-sunday-hours-log-06utc', 'manpower-sunday-hours-log-07utc');
select cron.schedule('manpower-sunday-hours-log-06utc', '0 6 * * 1', 'select public.manpower_invoke_sunday_hours_log()');
select cron.schedule('manpower-sunday-hours-log-07utc', '0 7 * * 1', 'select public.manpower_invoke_sunday_hours_log()');
