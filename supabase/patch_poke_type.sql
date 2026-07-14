alter table public.pokes
add column if not exists poke_type text not null default 'poke';

alter table public.pokes
drop constraint if exists pokes_poke_type_check;

alter table public.pokes
add constraint pokes_poke_type_check check (poke_type in ('poke', 'alive_reply'));
