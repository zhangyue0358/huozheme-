begin;

update account_deletion_requests
set personal_data_delete_after = least(personal_data_delete_after, requested_at + interval '7 days'),
    content_delete_after = least(content_delete_after, requested_at + interval '7 days')
where status <> 'cancelled';

commit;
