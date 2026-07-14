alter table public.profiles
add column if not exists phone_e164 text;

create unique index if not exists profiles_phone_e164_unique
on public.profiles (phone_e164)
where phone_e164 is not null;

create or replace function public.default_profile_phone_e164()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  user_email text;
  user_phone text;
begin
  select email, phone
  into user_email, user_phone
  from auth.users
  where id = new.id;

  if new.phone_e164 is null or new.phone_e164 = '' then
    new.phone_e164 := case
      when user_phone is not null and user_phone <> '' then user_phone
      when user_email = 'test-a@huozhema.local' then '+8613900000001'
      when user_email = 'test-b@huozhema.local' then '+8613900000002'
      else new.phone_e164
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_default_phone_e164 on public.profiles;
create trigger profiles_default_phone_e164
before insert or update on public.profiles
for each row
execute function public.default_profile_phone_e164();

update public.profiles as profile
set phone_e164 = case auth_user.email
  when 'test-a@huozhema.local' then '+8613900000001'
  when 'test-b@huozhema.local' then '+8613900000002'
  else coalesce(nullif(auth_user.phone, ''), profile.phone_e164)
end
from auth.users as auth_user
where profile.id = auth_user.id
  and (
    profile.phone_e164 is null
    or profile.phone_e164 = ''
    or auth_user.email in ('test-a@huozhema.local', 'test-b@huozhema.local')
  );
