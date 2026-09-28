-- Grant runtime permissions to the app database user.
-- Run this in Aliyun DMS SQLConsole while connected to database: huozhema.
-- This fixes errors like: permission denied for table otp_codes.

grant usage on schema public to huozhema_user;

grant select, insert, update, delete
on all tables in schema public
to huozhema_user;

grant usage, select, update
on all sequences in schema public
to huozhema_user;

alter default privileges in schema public
grant select, insert, update, delete
on tables
to huozhema_user;

alter default privileges in schema public
grant usage, select, update
on sequences
to huozhema_user;
