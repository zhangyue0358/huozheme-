alter table public.checkins
add column if not exists journal_text text not null default '';
