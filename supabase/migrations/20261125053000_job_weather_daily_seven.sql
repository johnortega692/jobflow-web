-- job_weather.daily is jsonb and now holds up to seven forecast days.
-- The previous check required exactly three entries, which rejects a longer outlook.

alter table public.job_weather drop constraint if exists job_weather_daily_len;

alter table public.job_weather
  add constraint job_weather_daily_len
  check (jsonb_array_length(daily) between 1 and 7);

comment on column public.job_weather.daily is
  'Up to seven local days: label, precip_prob, short_forecast, hi, lo.';
