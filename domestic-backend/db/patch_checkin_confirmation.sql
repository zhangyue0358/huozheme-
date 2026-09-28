begin;

alter table checkins
  add column if not exists confirmed_at timestamptz;

update checkins
set confirmed_at = coalesce(updated_at, created_at, now())
where confirmed_at is null
  and nullif(btrim(status_text), '') is not null;

create index if not exists checkins_confirmed_user_date_idx
on checkins (user_id, checkin_date desc)
where confirmed_at is not null;

commit;
