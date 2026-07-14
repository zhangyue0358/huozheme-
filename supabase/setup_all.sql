create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null,
  phone_e164 text,
  avatar_color text not null default '#9be27c',
  show_status_to_friends boolean not null default true,
  started_on date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.account_deletion_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  personal_data_delete_after timestamptz not null default (now() + interval '7 days'),
  content_delete_after timestamptz not null default (now() + interval '1 year'),
  status text not null default 'pending' check (status in ('pending', 'personal_data_deleted', 'content_deleted', 'cancelled')),
  processed_personal_at timestamptz,
  processed_content_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.account_deletion_requests
drop constraint if exists account_deletion_requests_status_check;

alter table public.account_deletion_requests
add constraint account_deletion_requests_status_check
check (status in ('pending', 'personal_data_deleted', 'content_deleted', 'cancelled'));

create table if not exists public.checkins (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  checkin_date date not null default current_date,
  status_text text not null default '',
  quote_text text not null default '今天不用很厉害，能把自己带到晚上就很好。',
  journal_text text not null default '',
  journal_photo_paths text[] not null default '{}',
  weather_text text not null default '☀️ 晴',
  created_at timestamptz not null default now(),
  unique (user_id, checkin_date)
);

create table if not exists public.todos (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  todo_date date not null default current_date,
  text text not null check (char_length(text) <= 40),
  done boolean not null default false,
  important boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.friendships (
  id bigint generated always as identity primary key,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'blocked')),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

create table if not exists public.friend_request_attempts (
  id bigint generated always as identity primary key,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  success boolean not null default false
);

create table if not exists public.pokes (
  id bigint generated always as identity primary key,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  poke_type text not null default 'poke' check (poke_type in ('poke', 'alive_reply')),
  created_at timestamptz not null default now(),
  check (sender_id <> receiver_id)
);

alter table public.profiles
add column if not exists show_status_to_friends boolean not null default true;

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

  if tg_op = 'INSERT' and (new.phone_e164 is null or new.phone_e164 = '') then
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
before insert on public.profiles
for each row
execute function public.default_profile_phone_e164();

create or replace function public.normalize_phone_e164(raw_phone text)
returns text
language plpgsql
immutable
as $$
declare
  compact text;
begin
  compact := regexp_replace(coalesce(raw_phone, ''), '[[:space:]-]', '', 'g');

  if compact = '' then
    return '';
  end if;

  if compact ~ '^\+' then
    return compact;
  end if;

  if compact ~ '^1[0-9]{10}$' then
    return '+86' || compact;
  end if;

  return compact;
end;
$$;

create or replace function public.send_friend_request_by_phone(raw_phone text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_phone text := public.normalize_phone_e164(raw_phone);
  target_profile_id uuid;
  existing_status text;
  attempt_id bigint;
  attempts_last_hour integer;
  attempts_last_day integer;
begin
  if current_user_id is null then
    raise exception '请先登录';
  end if;

  if target_phone = '' then
    raise exception '请输入好友手机号';
  end if;

  select count(*)
  into attempts_last_hour
  from public.friend_request_attempts
  where requester_id = current_user_id
    and created_at >= now() - interval '1 hour';

  select count(*)
  into attempts_last_day
  from public.friend_request_attempts
  where requester_id = current_user_id
    and created_at >= now() - interval '1 day';

  if attempts_last_hour >= 10 or attempts_last_day >= 30 then
    raise exception '添加太频繁，请稍后再试';
  end if;

  insert into public.friend_request_attempts (requester_id)
  values (current_user_id)
  returning id into attempt_id;

  select p.id
  into target_profile_id
  from public.profiles p
  where p.phone_e164 = target_phone
    and p.id <> current_user_id
    and not exists (
      select 1
      from public.account_deletion_requests r
      where r.user_id = p.id
        and r.status in ('pending', 'personal_data_deleted', 'content_deleted')
    )
  limit 1;

  if target_profile_id is null then
    raise exception '没有找到可添加的用户';
  end if;

  select f.status
  into existing_status
  from public.friendships f
  where (
    f.requester_id = current_user_id
    and f.addressee_id = target_profile_id
  ) or (
    f.requester_id = target_profile_id
    and f.addressee_id = current_user_id
  )
  limit 1;

  if existing_status is not null then
    if existing_status = 'accepted' then
      raise exception '你们已经是好友';
    end if;

    raise exception '已经有一条好友申请';
  end if;

  insert into public.friendships (requester_id, addressee_id, status)
  values (current_user_id, target_profile_id, 'pending');

  update public.friend_request_attempts
  set success = true
  where id = attempt_id;
end;
$$;

revoke all on function public.normalize_phone_e164(text) from public;
grant execute on function public.normalize_phone_e164(text) to authenticated;
grant execute on function public.normalize_phone_e164(text) to service_role;

revoke all on function public.send_friend_request_by_phone(text) from public;
grant execute on function public.send_friend_request_by_phone(text) to authenticated;

create or replace function public.process_account_deletion_retention()
returns table(personal_profiles_updated integer, content_accounts_processed integer)
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  personal_count integer := 0;
  content_count integer := 0;
  expired_content_users uuid[] := '{}'::uuid[];
begin
  update public.profiles p
  set
    avatar_color = '#777268',
    nickname = '已注销用户',
    phone_e164 = null,
    show_status_to_friends = false
  from public.account_deletion_requests r
  where r.user_id = p.id
    and r.status = 'pending'
    and r.personal_data_delete_after <= now();
  get diagnostics personal_count = row_count;

  delete from public.friendships f
  using public.account_deletion_requests r
  where r.status = 'pending'
    and r.personal_data_delete_after <= now()
    and (f.requester_id = r.user_id or f.addressee_id = r.user_id);

  delete from public.pokes p
  using public.account_deletion_requests r
  where r.status = 'pending'
    and r.personal_data_delete_after <= now()
    and (p.sender_id = r.user_id or p.receiver_id = r.user_id);

  update public.account_deletion_requests
  set
    processed_personal_at = coalesce(processed_personal_at, now()),
    status = 'personal_data_deleted'
  where status = 'pending'
    and personal_data_delete_after <= now();

  select coalesce(array_agg(user_id), '{}'::uuid[])
  into expired_content_users
  from public.account_deletion_requests
  where status in ('pending', 'personal_data_deleted')
    and content_delete_after <= now();

  content_count := coalesce(array_length(expired_content_users, 1), 0);

  if content_count > 0 then
    delete from storage.objects
    where bucket_id = 'journal-photos'
      and (storage.foldername(name))[1] = any (array(select unnest(expired_content_users)::text));

    delete from public.todos where user_id = any (expired_content_users);
    delete from public.checkins where user_id = any (expired_content_users);

    update public.account_deletion_requests
    set
      processed_content_at = coalesce(processed_content_at, now()),
      status = 'content_deleted'
    where user_id = any (expired_content_users);
  end if;

  return query select personal_count, content_count;
end;
$$;

revoke all on function public.process_account_deletion_retention() from public;
grant execute on function public.process_account_deletion_retention() to service_role;

alter table public.checkins
add column if not exists quote_text text not null default '今天不用很厉害，能把自己带到晚上就很好。';

alter table public.checkins
add column if not exists journal_text text not null default '';

alter table public.checkins
add column if not exists journal_photo_paths text[] not null default '{}';

alter table public.checkins
add column if not exists weather_text text not null default '☀️ 晴';

alter table public.pokes
add column if not exists poke_type text not null default 'poke';

alter table public.friendships
add column if not exists accepted_at timestamptz;

alter table public.pokes
drop constraint if exists pokes_poke_type_check;

alter table public.pokes
add constraint pokes_poke_type_check check (poke_type in ('poke', 'alive_reply'));

alter table public.todos
add column if not exists important boolean not null default false;

create or replace function public.enforce_daily_todo_limit()
returns trigger
language plpgsql
as $$
begin
  if (
    select count(*)
    from public.todos
    where user_id = new.user_id
      and todo_date = new.todo_date
  ) >= 3 then
    raise exception 'daily todo limit reached';
  end if;

  return new;
end;
$$;

drop trigger if exists todos_daily_limit on public.todos;
create trigger todos_daily_limit
before insert on public.todos
for each row
execute function public.enforce_daily_todo_limit();

alter table public.profiles enable row level security;
alter table public.checkins enable row level security;
alter table public.todos enable row level security;
alter table public.friendships enable row level security;
alter table public.friend_request_attempts enable row level security;
alter table public.pokes enable row level security;
alter table public.account_deletion_requests enable row level security;

drop policy if exists "profiles are readable by signed-in users" on public.profiles;
drop policy if exists "users read own and related profiles" on public.profiles;
drop policy if exists "users can update own profile" on public.profiles;
drop policy if exists "users can delete own profile" on public.profiles;
drop policy if exists "users can insert own profile" on public.profiles;
drop policy if exists "users read own account deletion request" on public.account_deletion_requests;
drop policy if exists "users create own account deletion request" on public.account_deletion_requests;
drop policy if exists "users manage own checkins" on public.checkins;
drop policy if exists "friends can read accepted checkins" on public.checkins;
drop policy if exists "users manage own todos" on public.todos;
drop policy if exists "users manage related friendships" on public.friendships;
drop policy if exists "users read related pokes" on public.pokes;
drop policy if exists "users delete related pokes" on public.pokes;
drop policy if exists "users send own pokes" on public.pokes;
drop policy if exists "users read own journal photos" on storage.objects;
drop policy if exists "users upload own journal photos" on storage.objects;
drop policy if exists "users delete own journal photos" on storage.objects;

insert into storage.buckets (id, name, public)
values ('journal-photos', 'journal-photos', false)
on conflict (id) do update set public = false;

create policy "users read own and related profiles"
on public.profiles for select
to authenticated
using (
  auth.uid() = id
  or exists (
    select 1
    from public.friendships f
    where f.status in ('pending', 'accepted')
      and (
        (f.requester_id = auth.uid() and f.addressee_id = profiles.id)
        or (f.addressee_id = auth.uid() and f.requester_id = profiles.id)
      )
  )
);

create policy "users can update own profile"
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "users can delete own profile"
on public.profiles for delete
to authenticated
using (auth.uid() = id);

create policy "users can insert own profile"
on public.profiles for insert
to authenticated
with check (auth.uid() = id);

create policy "users read own account deletion request"
on public.account_deletion_requests for select
to authenticated
using (auth.uid() = user_id);

create policy "users create own account deletion request"
on public.account_deletion_requests for insert
to authenticated
with check (auth.uid() = user_id);

create policy "users manage own checkins"
on public.checkins for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "friends can read accepted checkins"
on public.checkins for select
to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.friendships f
    join public.profiles p on p.id = checkins.user_id
    where f.status = 'accepted'
      and p.show_status_to_friends = true
      and (
        (f.requester_id = auth.uid() and f.addressee_id = checkins.user_id)
        or (f.addressee_id = auth.uid() and f.requester_id = checkins.user_id)
      )
  )
);

create policy "users manage own todos"
on public.todos for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "users manage related friendships"
on public.friendships for all
to authenticated
using (auth.uid() = requester_id or auth.uid() = addressee_id)
with check (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "users read related pokes"
on public.pokes for select
to authenticated
using (auth.uid() = sender_id or auth.uid() = receiver_id);

create policy "users delete related pokes"
on public.pokes for delete
to authenticated
using (auth.uid() = sender_id or auth.uid() = receiver_id);

create policy "users send own pokes"
on public.pokes for insert
to authenticated
with check (
  auth.uid() = sender_id
  and exists (
    select 1
    from public.friendships f
    where f.status = 'accepted'
      and (
        (f.requester_id = sender_id and f.addressee_id = receiver_id)
        or (f.addressee_id = sender_id and f.requester_id = receiver_id)
      )
  )
);

create policy "users read own journal photos"
on storage.objects for select
to authenticated
using (
  bucket_id = 'journal-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "users upload own journal photos"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'journal-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "users delete own journal photos"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'journal-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);
