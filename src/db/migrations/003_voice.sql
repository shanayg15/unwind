-- Owner voice sessions (Inkbox hosted Voice AI). A call gathers proposed intent only; it never authorizes.
create table if not exists voice_sessions (
  id text primary key,
  case_id text not null references cases(id) on delete cascade,
  store_id text not null,
  plan_id text,
  plan_hash text,
  intent_version integer not null,
  question text not null,
  provider_call_id text unique,
  status text not null default 'placing' check (status in ('placing','in_progress','ended','failed','cancelled','unknown')),
  outcome text,
  hangup_reason text,
  authority_mode text,
  decision_summary text,
  processed_at timestamptz,
  hangup_requested_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists voice_sessions_active on voice_sessions(status, created_at) where status in ('placing','in_progress');
