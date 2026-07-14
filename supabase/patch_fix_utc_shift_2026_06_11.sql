-- Fix rows that were created on June 11 in China local time but saved as June 10
-- because the app previously derived dates from UTC.
--
-- Run this once only if your June 11 diary/todos show up under June 10.

begin;

update public.checkins as wrong_day
set checkin_date = date '2026-06-11'
where wrong_day.checkin_date = date '2026-06-10'
  and wrong_day.created_at >= timestamptz '2026-06-10 16:00:00+00'
  and wrong_day.created_at < timestamptz '2026-06-11 16:00:00+00'
  and not exists (
    select 1
    from public.checkins as right_day
    where right_day.user_id = wrong_day.user_id
      and right_day.checkin_date = date '2026-06-11'
  );

update public.todos
set todo_date = date '2026-06-11'
where todo_date = date '2026-06-10'
  and created_at >= timestamptz '2026-06-10 16:00:00+00'
  and created_at < timestamptz '2026-06-11 16:00:00+00';

commit;
