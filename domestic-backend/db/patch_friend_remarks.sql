-- Apply as the owner of the application's tables before deploying the new API.
-- Additive migration: existing friendships, profiles and old clients are unchanged.
set search_path to public;

create table if not exists friend_remarks (
  friendship_id bigint not null references friendships(id) on delete cascade,
  owner_id uuid not null references app_users(id) on delete cascade,
  remark text not null check (char_length(remark) between 1 and 20),
  updated_at timestamptz not null default now(),
  primary key (friendship_id, owner_id)
);

create index if not exists friend_remarks_owner_idx on friend_remarks (owner_id);
