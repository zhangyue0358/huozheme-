-- Make phone-based friend requests resilient for older accounts.
-- Run this once after patch_friend_request_security.sql.

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

  if compact ~ '^861[0-9]{10}$' then
    return '+' || compact;
  end if;

  if compact ~ '^1[0-9]{10}$' then
    return '+86' || compact;
  end if;

  return compact;
end;
$$;

grant execute on function public.normalize_phone_e164(text) to authenticated;
grant execute on function public.normalize_phone_e164(text) to service_role;

update public.profiles p
set phone_e164 = u.phone
from auth.users u
where p.id = u.id
  and (p.phone_e164 is null or p.phone_e164 = '')
  and u.phone is not null
  and u.phone <> '';

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
  current_phone text;
  target_has_auth_user boolean;
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

  select coalesce(p.phone_e164, u.phone)
  into current_phone
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = current_user_id;

  if current_phone = target_phone then
    raise exception '不能添加自己';
  end if;

  update public.profiles p
  set phone_e164 = u.phone
  from auth.users u
  where p.id = u.id
    and (p.phone_e164 is null or p.phone_e164 = '')
    and u.phone is not null
    and u.phone <> '';

  insert into public.profiles (id, nickname, phone_e164, avatar_color, show_status_to_friends)
  select
    u.id,
    '用户' || right(u.phone, 4),
    u.phone,
    '#ffd166',
    true
  from auth.users u
  where u.phone = target_phone
    and u.id <> current_user_id
    and not exists (
      select 1
      from public.profiles p
      where p.id = u.id
    )
  on conflict (id) do nothing;

  select exists (
    select 1
    from auth.users u
    where u.phone = target_phone
      and u.id <> current_user_id
  )
  into target_has_auth_user;

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
    if not target_has_auth_user then
      raise exception '这个手机号还没有注册活着吗';
    end if;

    raise exception '对方资料还没同步，请让对方重新登录一次';
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

grant execute on function public.send_friend_request_by_phone(text) to authenticated;
