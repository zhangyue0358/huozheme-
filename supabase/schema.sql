create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null,
  avatar_color text not null default '#9be27c',
  started_on date not null default current_date,
  created_at timestamptz not null default now()
);

create table public.checkins (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  checkin_date date not null default current_date,
  status_text text not null default '我还活着，今天也算数。',
  created_at timestamptz not null default now(),
  unique (user_id, checkin_date)
);

create table public.todos (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  todo_date date not null default current_date,
  text text not null check (char_length(text) <= 40),
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.friendships (
  id bigint generated always as identity primary key,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default now(),
  unique (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

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

create policy "profiles are readable by signed-in users"
on public.profiles for select
to authenticated
using (true);

create policy "users can update own profile"
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "users can insert own profile"
on public.profiles for insert
to authenticated
with check (auth.uid() = id);

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
    where f.status = 'accepted'
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
