-- Add password login credentials without changing existing SMS-only accounts.
create table if not exists user_password_credentials (
  user_id uuid primary key,
  password_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  password_set_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists user_password_credentials_set_updated_at on user_password_credentials;
create trigger user_password_credentials_set_updated_at
before update on user_password_credentials
for each row execute function set_updated_at();

grant select, insert, update, delete on user_password_credentials to huozhema_user;
