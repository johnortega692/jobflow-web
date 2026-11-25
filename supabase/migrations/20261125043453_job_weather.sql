-- Exterior-job rain monitoring.
-- Coordinates are filled once when an exterior project's site address is saved.
-- A 15-minute job refreshes job_weather from the National Weather Service.
-- A failed forecast fetch does not write, so the previous row and fetched_at stay.

alter table public.projects
  add column if not exists is_exterior boolean not null default false,
  add column if not exists lat double precision,
  add column if not exists lng double precision;

comment on column public.projects.is_exterior is
  'Exterior job site. Rain is monitored only when true.';
comment on column public.projects.lat is
  'Geocoded site latitude. Cleared when the site address changes.';
comment on column public.projects.lng is
  'Geocoded site longitude. Cleared when the site address changes.';

create index if not exists projects_exterior_located_idx
  on public.projects (lat, lng)
  where is_exterior and lat is not null and lng is not null;

create table public.job_weather (
  project_id uuid primary key references public.projects (id) on delete cascade,
  fetched_at timestamptz not null,
  raining_now boolean not null,
  precip_prob_next_hours jsonb not null,
  next_rain_at timestamptz,
  daily jsonb not null,
  alert_text text,
  source text not null,
  constraint job_weather_hours_is_array check (jsonb_typeof(precip_prob_next_hours) = 'array'),
  constraint job_weather_hours_len check (jsonb_array_length(precip_prob_next_hours) = 8),
  constraint job_weather_daily_is_array check (jsonb_typeof(daily) = 'array'),
  constraint job_weather_daily_len check (jsonb_array_length(daily) between 1 and 7),
  constraint job_weather_source_not_blank check (length(btrim(source)) > 0)
);

comment on table public.job_weather is
  'Latest National Weather Service snapshot for an exterior job. Written by the scheduled refresh.';
comment on column public.job_weather.precip_prob_next_hours is
  'Eight hourly precipitation probabilities, starting with the current hour. Null when the forecast omits a value.';
comment on column public.job_weather.daily is
  'Up to seven local days: label, precip_prob, short_forecast, hi, lo.';
comment on column public.job_weather.alert_text is
  'Active NWS alert headlines for the site. Null when none are in effect.';

alter table public.job_weather enable row level security;

-- Same access as projects: approved users can read and write; only an admin can delete.
drop policy if exists "job_weather_select" on public.job_weather;
create policy "job_weather_select" on public.job_weather
  for select to authenticated
  using ((select public.is_approved_user()));

drop policy if exists "job_weather_insert" on public.job_weather;
create policy "job_weather_insert" on public.job_weather
  for insert to authenticated
  with check ((select public.is_approved_user()));

drop policy if exists "job_weather_update" on public.job_weather;
create policy "job_weather_update" on public.job_weather
  for update to authenticated
  using ((select public.is_approved_user()))
  with check ((select public.is_approved_user()));

drop policy if exists "job_weather_delete" on public.job_weather;
create policy "job_weather_delete" on public.job_weather
  for delete to authenticated
  using ((select public.is_app_admin()));

revoke all on table public.job_weather from public, anon;
grant select, insert, update, delete on table public.job_weather to authenticated;
grant select, insert, update, delete on table public.job_weather to service_role;

-- One-line site address. The geocode function reads this string and writes coordinates only if it still matches.
-- site_address_override wins. Otherwise street plus city/zip/county, falling back to job_address2.
create or replace function public.project_weather_address(
  p_job_address text,
  p_job_address2 text,
  p_site_address_override text,
  p_data jsonb
) returns text
language sql
immutable
set search_path = ''
as $$
  with parts as (
    select
      nullif(btrim(regexp_replace(coalesce(p_site_address_override, ''), '[[:space:]]+', ' ', 'g')), '') as override,
      nullif(btrim(regexp_replace(coalesce(p_job_address, ''), '[[:space:]]+', ' ', 'g')), '') as street,
      nullif(btrim(regexp_replace(coalesce(p_job_address2, ''), '[[:space:]]+', ' ', 'g')), '') as line2,
      nullif(btrim(regexp_replace(coalesce(p_data #>> '{job_info,job_city}', ''), '[[:space:]]+', ' ', 'g')), '') as city,
      nullif(btrim(regexp_replace(coalesce(p_data #>> '{job_info,job_zip}', ''), '[[:space:]]+', ' ', 'g')), '') as zip,
      nullif(btrim(regexp_replace(coalesce(p_data #>> '{job_info,job_county}', ''), '[[:space:]]+', ' ', 'g')), '') as county
  )
  select case
    when override is not null then override
    else nullif(
      btrim(regexp_replace(
        concat_ws(', ', street, coalesce(nullif(concat_ws(', ', city, zip, county), ''), line2)),
        '[[:space:]]+',
        ' ',
        'g'
      )),
      ''
    )
  end
  from parts;
$$;

revoke all on function public.project_weather_address(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.project_weather_address(text, text, text, jsonb) to service_role;

-- Address string the geocoder should look up. Null unless the project is exterior and has an address.
create or replace function public.project_exterior_geocode_target(p_project_id uuid)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select public.project_weather_address(p.job_address, p.job_address2, p.site_address_override, p.data)
  from public.projects as p
  where p.id = p_project_id
    and p.is_exterior;
$$;

revoke all on function public.project_exterior_geocode_target(uuid) from public, anon, authenticated;
grant execute on function public.project_exterior_geocode_target(uuid) to service_role;

-- Service role writes coordinates only while the saved address is still the one that was geocoded.
create or replace function public.project_set_weather_coords(
  p_project_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_address text
) returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_updated integer;
begin
  if p_lat is null or p_lng is null or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    return false;
  end if;

  update public.projects as p
  set lat = p_lat,
      lng = p_lng
  where p.id = p_project_id
    and p.is_exterior
    and public.project_weather_address(p.job_address, p.job_address2, p.site_address_override, p.data) = p_address;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.project_set_weather_coords(uuid, double precision, double precision, text) from public, anon, authenticated;
grant execute on function public.project_set_weather_coords(uuid, double precision, double precision, text) to service_role;

-- Address edits drop stale coordinates. Runs as the owner so the weather-row
-- delete is not blocked by the admin-only delete policy. Trigger functions
-- cannot be called as normal RPCs.
create or replace function public.projects_clear_coords_on_address_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next text;
  v_previous text;
begin
  if tg_table_name is distinct from 'projects' then
    return new;
  end if;

  v_next := public.project_weather_address(new.job_address, new.job_address2, new.site_address_override, new.data);
  v_previous := public.project_weather_address(old.job_address, old.job_address2, old.site_address_override, old.data);
  if v_next is not distinct from v_previous then
    return new;
  end if;

  new.lat := null;
  new.lng := null;
  delete from public.job_weather where project_id = new.id;
  return new;
end;
$$;

revoke all on function public.projects_clear_coords_on_address_change() from public, anon;
grant execute on function public.projects_clear_coords_on_address_change() to authenticated, service_role;

drop trigger if exists projects_clear_coords_on_address_change on public.projects;
create trigger projects_clear_coords_on_address_change
  before update of job_address, job_address2, site_address_override, data
  on public.projects
  for each row
  execute function public.projects_clear_coords_on_address_change();

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Asks the geocode function to run. Failures are logged and do not block the save.
-- Needs definer rights to read the vault URL and the cron secret.
create or replace function public.projects_request_exterior_geocode()
returns trigger
language plpgsql
security definer
set search_path = public, net
as $$
declare
  v_address text;
  v_previous text;
  v_secret text;
  v_url text;
  v_anon text;
begin
  if tg_table_name is distinct from 'projects' then
    return new;
  end if;
  if not coalesce(new.is_exterior, false) then
    return new;
  end if;

  v_address := public.project_weather_address(new.job_address, new.job_address2, new.site_address_override, new.data);
  if v_address is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_previous := public.project_weather_address(old.job_address, old.job_address2, old.site_address_override, old.data);
    if v_address is not distinct from v_previous then
      -- Stored coordinates belong to this address. Look up again only after it changes.
      if new.lat is not null and new.lng is not null then
        return new;
      end if;
      -- Already exterior: an empty result is not repeated on later saves of the same address.
      if coalesce(old.is_exterior, false) then
        return new;
      end if;
    end if;
  end if;

  select s.cron_secret into v_secret
  from public.field_tools_link_settings as s
  where s.id = 1;
  select ds.decrypted_secret into v_url
  from vault.decrypted_secrets as ds
  where ds.name = 'project_url'
  limit 1;
  select ds.decrypted_secret into v_anon
  from vault.decrypted_secrets as ds
  where ds.name = 'publishable_key'
  limit 1;
  if v_secret is null or btrim(v_secret) = '' or v_url is null or btrim(v_url) = '' or v_anon is null or btrim(v_anon) = '' then
    raise warning 'exterior geocode skipped: cron secret or vault url is missing';
    return new;
  end if;

  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/job-exterior-geocode',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_anon,
      'Authorization', 'Bearer ' || v_anon
    ),
    body := jsonb_build_object('secret', v_secret, 'project_id', new.id),
    timeout_milliseconds := 20000
  );
  return new;
exception
  when others then
    raise warning 'exterior geocode request failed: %', sqlerrm;
    return new;
end;
$$;

revoke all on function public.projects_request_exterior_geocode() from public, anon;
grant execute on function public.projects_request_exterior_geocode() to authenticated, service_role;

drop trigger if exists projects_request_exterior_geocode on public.projects;
create trigger projects_request_exterior_geocode
  after insert or update of job_address, job_address2, site_address_override, data, is_exterior
  on public.projects
  for each row
  when (new.is_exterior)
  execute function public.projects_request_exterior_geocode();

create or replace function public.job_weather_invoke_refresh()
returns bigint
language plpgsql
security definer
set search_path = public, net
as $$
declare
  v_secret text;
  v_url text;
  v_anon text;
  v_id bigint;
begin
  select s.cron_secret into v_secret
  from public.field_tools_link_settings as s
  where s.id = 1;
  if v_secret is null or btrim(v_secret) = '' then
    raise exception 'field_tools_link_settings.cron_secret is missing';
  end if;

  select ds.decrypted_secret into v_url
  from vault.decrypted_secrets as ds
  where ds.name = 'project_url'
  limit 1;
  select ds.decrypted_secret into v_anon
  from vault.decrypted_secrets as ds
  where ds.name = 'publishable_key'
  limit 1;
  if v_url is null or btrim(v_url) = '' or v_anon is null or btrim(v_anon) = '' then
    raise exception 'vault secrets project_url and publishable_key are required';
  end if;

  select net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/job-weather-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_anon,
      'Authorization', 'Bearer ' || v_anon
    ),
    body := jsonb_build_object('secret', v_secret),
    timeout_milliseconds := 150000
  ) into v_id;

  return v_id;
end;
$$;

revoke all on function public.job_weather_invoke_refresh() from public, anon, authenticated;
grant execute on function public.job_weather_invoke_refresh() to postgres;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'job-weather-refresh') then
    perform cron.unschedule('job-weather-refresh');
  end if;
  perform cron.schedule(
    'job-weather-refresh',
    '*/15 * * * *',
    $cron$select public.job_weather_invoke_refresh()$cron$
  );
end;
$$;

notify pgrst, 'reload schema';
