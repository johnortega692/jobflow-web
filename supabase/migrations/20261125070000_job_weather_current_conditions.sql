-- Current-hour conditions and the start time of each hourly probability.
-- Existing rows stay valid until the next refresh fills these columns.

alter table public.job_weather
  add column if not exists temp_now integer,
  add column if not exists wind_mph integer,
  add column if not exists wind_dir text,
  add column if not exists condition_now text,
  add column if not exists hourly_times jsonb;

alter table public.job_weather drop constraint if exists job_weather_hourly_times_shape;
alter table public.job_weather
  add constraint job_weather_hourly_times_shape
  check (
    hourly_times is null
    or (jsonb_typeof(hourly_times) = 'array' and jsonb_array_length(hourly_times) = 8)
  );

comment on column public.job_weather.temp_now is
  'Temperature of the current NWS hourly period. Null when that period omits it.';
comment on column public.job_weather.wind_mph is
  'Wind speed in mph from the current hourly period, parsed from the NWS windSpeed text.';
comment on column public.job_weather.wind_dir is
  'Wind direction from the current hourly period, such as SW.';
comment on column public.job_weather.condition_now is
  'Short forecast text for the current hourly period.';
comment on column public.job_weather.hourly_times is
  'ISO start time for each of the eight precip_prob_next_hours entries. Null until a refresh stores them.';
comment on column public.job_weather.daily is
  'Up to seven local days: label, precip_prob, short_forecast, hi, lo, today_partial. hi is null and today_partial is true when today''s daytime period has already passed.';

notify pgrst, 'reload schema';
