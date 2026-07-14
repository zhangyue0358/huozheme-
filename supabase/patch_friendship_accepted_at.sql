alter table public.friendships
add column if not exists accepted_at timestamptz;

update public.friendships
set accepted_at = created_at
where status = 'accepted'
  and accepted_at is null;
