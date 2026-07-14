alter table public.profiles
add column if not exists show_status_to_friends boolean not null default true;

drop policy if exists "users can delete own profile" on public.profiles;

create policy "users can delete own profile"
on public.profiles for delete
to authenticated
using (auth.uid() = id);

drop policy if exists "friends can read accepted checkins" on public.checkins;

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
