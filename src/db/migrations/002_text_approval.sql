-- Reply-to-approve: a short code bound to one approval request (one plan hash, one owner, one case).
alter table approval_requests add column if not exists code_hash text;
alter table approval_requests add column if not exists channel text;
create index if not exists approval_requests_case_open on approval_requests(case_id) where used_at is null;
alter table approval_requests add column if not exists failed_attempts integer not null default 0;
