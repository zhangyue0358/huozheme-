-- Add one replaceable OSS avatar record per user without changing existing profile data.

create table if not exists profile_avatars (
  -- The production runtime role cannot add a foreign key to app_users.
  -- Account deletion and app-data cleanup explicitly remove these rows.
  user_id uuid primary key,
  object_key text not null,
  content_type text not null default 'image/jpeg',
  byte_size integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists profile_avatars_set_updated_at on profile_avatars;
create trigger profile_avatars_set_updated_at
before update on profile_avatars
for each row execute function set_updated_at();

grant select, insert, update, delete on profile_avatars to huozhema_user;
