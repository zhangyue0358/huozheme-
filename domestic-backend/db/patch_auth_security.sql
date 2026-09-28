-- Limit OTP guessing and allow password resets to revoke older access tokens.
-- Safe for existing users: legacy tokens are treated as auth_version 1.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.app_users
add column if not exists auth_version integer not null default 1;

alter table public.otp_codes
add column if not exists failed_attempts integer not null default 0;

commit;

select table_name, column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'app_users' and column_name = 'auth_version')
    or (table_name = 'otp_codes' and column_name = 'failed_attempts'))
order by table_name;
