-- Keep acknowledgement state separate because the runtime database role does not
-- own the existing pokes table in production.
create table if not exists alive_reply_acknowledgements (
  reply_id bigint primary key,
  receiver_id uuid not null,
  acknowledged_at timestamptz not null default now()
);

create index if not exists alive_reply_acknowledgements_receiver_idx
on alive_reply_acknowledgements (receiver_id, acknowledged_at desc);

grant select, insert, update, delete on alive_reply_acknowledgements to huozhema_user;
