alter table public.checkins
add column if not exists journal_photo_paths text[] not null default '{}';

insert into storage.buckets (id, name, public)
values ('journal-photos', 'journal-photos', false)
on conflict (id) do update set public = false;

drop policy if exists "users read own journal photos" on storage.objects;
drop policy if exists "users upload own journal photos" on storage.objects;
drop policy if exists "users delete own journal photos" on storage.objects;

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
