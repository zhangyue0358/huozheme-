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
