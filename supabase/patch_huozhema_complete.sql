alter table public.checkins
add column if not exists quote_text text not null default '今天不用很厉害，能把自己带到晚上就很好。';

alter table public.checkins
add column if not exists journal_text text not null default '';

alter table public.checkins
add column if not exists journal_photo_paths text[] not null default '{}';

insert into storage.buckets (id, name, public)
values ('journal-photos', 'journal-photos', false)
on conflict (id) do update set public = false;

alter table public.todos
add column if not exists important boolean not null default false;

create table if not exists public.pokes (
  id bigint generated always as identity primary key,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (sender_id <> receiver_id)
);

alter table public.pokes enable row level security;

drop policy if exists "users read related pokes" on public.pokes;
drop policy if exists "users delete related pokes" on public.pokes;
drop policy if exists "users send own pokes" on public.pokes;
drop policy if exists "users read own journal photos" on storage.objects;
drop policy if exists "users upload own journal photos" on storage.objects;
drop policy if exists "users delete own journal photos" on storage.objects;

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
