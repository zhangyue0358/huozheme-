drop policy if exists "users delete related pokes" on public.pokes;

create policy "users delete related pokes"
on public.pokes for delete
to authenticated
using (auth.uid() = sender_id or auth.uid() = receiver_id);
