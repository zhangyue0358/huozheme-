create table if not exists public.friend_request_attempts (
  id bigint generated always as identity primary key,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  success boolean not null default false
);

alter table public.friend_request_attempts enable row level security;

drop policy if exists "profiles are readable by signed-in users" on public.profiles;
drop policy if exists "users read own and related profiles" on public.profiles;

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
