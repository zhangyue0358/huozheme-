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

alter table public.account_deletion_requests enable row level security;

drop policy if exists "users read own account deletion request" on public.account_deletion_requests;
drop policy if exists "users create own account deletion request" on public.account_deletion_requests;

create policy "users read own account deletion request"
on public.account_deletion_requests for select
to authenticated
using (auth.uid() = user_id);

create policy "users create own account deletion request"
on public.account_deletion_requests for insert
to authenticated
with check (auth.uid() = user_id);
