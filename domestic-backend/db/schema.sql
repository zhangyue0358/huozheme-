create extension if not exists pgcrypto;

set search_path to public;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique,
  last_login_at timestamptz,
  disabled_at timestamptz,
  auth_version integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  user_id uuid primary key references app_users(id) on delete cascade,
  nickname text not null,
  avatar_color text not null default '#9be27c',
  show_status_to_friends boolean not null default true,
  started_on date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists profile_avatars (
  user_id uuid primary key references app_users(id) on delete cascade,
  object_key text not null,
  content_type text not null default 'image/jpeg',
  byte_size integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_password_credentials (
  user_id uuid primary key references app_users(id) on delete cascade,
  password_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  password_set_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists otp_codes (
  id bigint generated always as identity primary key,
  phone_e164 text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  failed_attempts integer not null default 0,
  ip_address text,
  created_at timestamptz not null default now()
);

create index if not exists otp_codes_phone_created_idx
on otp_codes (phone_e164, created_at desc);

create table if not exists checkins (
  id bigint generated always as identity primary key,
  user_id uuid not null references app_users(id) on delete cascade,
  checkin_date date not null default current_date,
  status_text text not null default '',
  quote_text text not null default '今天不用很厉害，能把自己带到晚上就很好。',
  quote_saved_at timestamptz,
  journal_text text not null default '',
  journal_photo_paths text[] not null default '{}',
  weather_text text not null default '☀️ 晴',
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, checkin_date)
);

create index if not exists checkins_user_date_idx
on checkins (user_id, checkin_date desc);

create index if not exists checkins_confirmed_user_date_idx
on checkins (user_id, checkin_date desc)
where confirmed_at is not null;

create table if not exists todos (
  id bigint generated always as identity primary key,
  user_id uuid not null references app_users(id) on delete cascade,
  todo_date date not null default current_date,
  text text not null check (char_length(text) <= 40),
  done boolean not null default false,
  important boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists todos_user_date_idx
on todos (user_id, todo_date desc, created_at);

create table if not exists personal_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references app_users(id) on delete cascade,
  recipient_name text not null check (char_length(recipient_name) between 1 and 20),
  message_text text not null check (char_length(message_text) between 1 and 600),
  position smallint not null check (position between 1 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, position)
);

create index if not exists personal_messages_user_position_idx
on personal_messages (user_id, position);

create table if not exists friendships (
  id bigint generated always as identity primary key,
  requester_id uuid not null references app_users(id) on delete cascade,
  addressee_id uuid not null references app_users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'blocked')),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> addressee_id)
);

create unique index if not exists friendships_open_pair_unique
on friendships (
  least(requester_id, addressee_id),
  greatest(requester_id, addressee_id)
)
where status in ('pending', 'accepted');

create index if not exists friendships_requester_idx
on friendships (requester_id, status);

create index if not exists friendships_addressee_idx
on friendships (addressee_id, status);

create table if not exists friend_request_attempts (
  id bigint generated always as identity primary key,
  requester_id uuid not null references app_users(id) on delete cascade,
  success boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists friend_request_attempts_requester_created_idx
on friend_request_attempts (requester_id, created_at desc);

create table if not exists pokes (
  id bigint generated always as identity primary key,
  sender_id uuid not null references app_users(id) on delete cascade,
  receiver_id uuid not null references app_users(id) on delete cascade,
  poke_type text not null default 'poke' check (poke_type in ('poke', 'alive_reply')),
  signal_date date not null default current_date,
  created_at timestamptz not null default now(),
  check (sender_id <> receiver_id)
);

create unique index if not exists pokes_one_type_per_day_unique
on pokes (sender_id, receiver_id, poke_type, signal_date);

create index if not exists pokes_receiver_created_idx
on pokes (receiver_id, created_at desc);

create index if not exists pokes_sender_created_idx
on pokes (sender_id, created_at desc);

create table if not exists alive_reply_acknowledgements (
  reply_id bigint primary key references pokes(id) on delete cascade,
  receiver_id uuid not null references app_users(id) on delete cascade,
  acknowledged_at timestamptz not null default now()
);

create index if not exists alive_reply_acknowledgements_receiver_idx
on alive_reply_acknowledgements (receiver_id, acknowledged_at desc);

create table if not exists journal_photos (
  id bigint generated always as identity primary key,
  user_id uuid not null references app_users(id) on delete cascade,
  checkin_date date not null default current_date,
  object_key text not null,
  content_type text not null default 'image/jpeg',
  byte_size integer,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, object_key)
);

create index if not exists journal_photos_user_date_idx
on journal_photos (user_id, checkin_date desc);

create table if not exists account_deletion_requests (
  user_id uuid primary key references app_users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  personal_data_delete_after timestamptz not null default (now() + interval '7 days'),
  content_delete_after timestamptz not null default (now() + interval '7 days'),
  status text not null default 'pending'
    check (status in ('pending', 'personal_data_deleted', 'content_deleted', 'cancelled')),
  processed_personal_at timestamptz,
  processed_content_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on profiles;
create trigger profiles_set_updated_at
before update on profiles
for each row execute function set_updated_at();

drop trigger if exists profile_avatars_set_updated_at on profile_avatars;
create trigger profile_avatars_set_updated_at
before update on profile_avatars
for each row execute function set_updated_at();

drop trigger if exists user_password_credentials_set_updated_at on user_password_credentials;
create trigger user_password_credentials_set_updated_at
before update on user_password_credentials
for each row execute function set_updated_at();

drop trigger if exists checkins_set_updated_at on checkins;
create trigger checkins_set_updated_at
before update on checkins
for each row execute function set_updated_at();

drop trigger if exists todos_set_updated_at on todos;
create trigger todos_set_updated_at
before update on todos
for each row execute function set_updated_at();

drop trigger if exists personal_messages_set_updated_at on personal_messages;
create trigger personal_messages_set_updated_at
before update on personal_messages
for each row execute function set_updated_at();

drop trigger if exists friendships_set_updated_at on friendships;
create trigger friendships_set_updated_at
before update on friendships
for each row execute function set_updated_at();
