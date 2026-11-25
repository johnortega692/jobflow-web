-- Site coordinates and a shared rain-line cache for Manpower Assign.
-- The edge function writes these with the service role. The browser never reads them directly.

create table if not exists public.manpower_site_geocodes (
  project_id uuid primary key references public.projects(id) on delete cascade,
  address_key text not null,
  lat double precision,
  lng double precision,
  geocoded_at timestamptz not null default now()
);

create table if not exists public.manpower_weather_cache (
  lat_bucket numeric(7, 2) not null,
  lng_bucket numeric(7, 2) not null,
  forecast_date date not null,
  summary text not null,
  fetched_at timestamptz not null default now(),
  primary key (lat_bucket, lng_bucket, forecast_date)
);

alter table public.manpower_site_geocodes enable row level security;
alter table public.manpower_weather_cache enable row level security;

revoke all on table public.manpower_site_geocodes from public, anon, authenticated;
revoke all on table public.manpower_weather_cache from public, anon, authenticated;
grant select, insert, update, delete on table public.manpower_site_geocodes to service_role;
grant select, insert, update, delete on table public.manpower_weather_cache to service_role;

comment on table public.manpower_site_geocodes is
  'Latitude and longitude for a project address. Reused until the address changes.';
comment on table public.manpower_weather_cache is
  'Work-window rain line shared by job sites within about a kilometer.';
