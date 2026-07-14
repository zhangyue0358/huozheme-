alter table public.checkins
add column if not exists weather_text text not null default '☀️ 晴';
