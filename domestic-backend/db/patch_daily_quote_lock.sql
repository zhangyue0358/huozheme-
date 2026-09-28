-- A non-null timestamp marks an explicitly saved, immutable daily quote.
begin;

alter table checkins
add column if not exists quote_saved_at timestamptz;

-- Preserve earlier custom quotes as saved. The default sentence cannot be
-- distinguished from an unsaved placeholder in older records.
update checkins
set quote_saved_at = coalesce(updated_at, confirmed_at, created_at, now())
where quote_saved_at is null
  and confirmed_at is not null
  and btrim(quote_text) <> ''
  and quote_text <> '今天不用很厉害，能把自己带到晚上就很好。';

commit;
