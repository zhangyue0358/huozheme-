-- Add persistent, per-recipient personal messages without changing existing user data.

create table if not exists personal_messages (
  id bigint generated always as identity primary key,
  -- The production runtime role cannot add a foreign key to app_users.
  -- Account deletion and app-data cleanup explicitly remove these rows.
  user_id uuid not null,
  recipient_name text not null check (char_length(recipient_name) between 1 and 20),
  message_text text not null check (char_length(message_text) between 1 and 600),
  position smallint not null check (position between 1 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, position)
);

create index if not exists personal_messages_user_position_idx
on personal_messages (user_id, position);

drop trigger if exists personal_messages_set_updated_at on personal_messages;
create trigger personal_messages_set_updated_at
before update on personal_messages
for each row execute function set_updated_at();

grant select, insert, update, delete on personal_messages to huozhema_user;
grant usage, select, update on sequence personal_messages_id_seq to huozhema_user;
