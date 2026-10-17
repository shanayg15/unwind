-- UNDO schema v1. Controlled Shopify-style demo store on Postgres.
-- Invariants enforced here (not only in app code):
--   U-I1/U-I6: every component write bumps a monotonic revision and appends a journal row
--              in the same transaction (triggers on product_prices/product_content/store_slots).
--   U-I7: order snapshots are immutable (no UPDATE; DELETE only under the demo-reset guard).
--   Journal/audit rows are append-only.

create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

create table stores (
  id text primary key,
  name text not null,
  namespace text not null unique,
  is_demo boolean not null default false,
  policy jsonb not null,
  created_at timestamptz not null default now()
);

create table principals (
  id text primary key,
  kind text not null check (kind in ('owner','operator','agent','customer','evaluator','system')),
  display_name text not null,
  email text,
  phone_e164 text,
  created_at timestamptz not null default now()
);

create table store_memberships (
  store_id text not null references stores(id) on delete cascade,
  principal_id text not null references principals(id),
  role text not null check (role in ('owner','operator','agent','customer','evaluator')),
  primary key (store_id, principal_id)
);

create table api_tokens (
  id text primary key,
  token_hash text not null unique,
  principal_id text not null references principals(id),
  store_id text not null references stores(id) on delete cascade,
  role text not null check (role in ('owner','operator','agent','customer','evaluator')),
  label text not null,
  case_id text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

create table products (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  collection text not null check (collection in ('premium','clearance','core')),
  sku text not null,
  title text not null,
  unique (store_id, sku)
);
create index products_store_idx on products(store_id);

-- Independently versioned components ---------------------------------------
create table product_prices (
  product_id text primary key references products(id) on delete cascade,
  store_id text not null references stores(id) on delete cascade,
  amount_minor integer not null check (amount_minor > 0),
  currency char(3) not null check (currency = 'USD'),
  revision bigint not null default 1,
  last_actor text,
  last_action_id text,
  updated_at timestamptz not null default now()
);

create table product_content (
  product_id text not null references products(id) on delete cascade,
  store_id text not null references stores(id) on delete cascade,
  component_key text not null check (component_key in ('promotional_copy','sizing_info')),
  value text not null check (char_length(value) <= 2000),
  revision bigint not null default 1,
  last_actor text,
  last_action_id text,
  updated_at timestamptz not null default now(),
  primary key (product_id, component_key)
);
create unique index product_content_store_key on product_content(store_id, product_id, component_key);

create table store_slots (
  slot_id text primary key,
  store_id text not null references stores(id) on delete cascade,
  slot_kind text not null check (slot_kind in ('premium_home','clearance_home','navigation')),
  content jsonb not null,
  revision bigint not null default 1,
  last_actor text,
  last_action_id text,
  updated_at timestamptz not null default now(),
  unique (store_id, slot_kind)
);

create table inventory (
  product_id text primary key references products(id) on delete cascade,
  store_id text not null references stores(id) on delete cascade,
  on_hand integer not null check (on_hand >= 0)
);

-- Journal of every component write (trigger-appended) ----------------------
create table component_writes (
  id bigserial primary key,
  store_id text not null,
  component_type text not null check (component_type in ('price','content','slot')),
  component_id text not null,
  component_key text not null,
  revision_before bigint,
  revision_after bigint not null,
  value_before jsonb,
  value_after jsonb not null,
  actor text not null,
  action_id text,
  written_at timestamptz not null default now()
);
create index component_writes_lookup on component_writes(store_id, component_type, component_id, component_key, revision_after);

create or replace function undo_writer() returns text language sql stable as $$
  select nullif(current_setting('undo.writer', true), '')
$$;
create or replace function undo_action() returns text language sql stable as $$
  select nullif(current_setting('undo.action_id', true), '')
$$;

create or replace function undo_component_guard() returns trigger language plpgsql as $$
begin
  if undo_writer() is null then
    raise exception 'component writes must go through the UNDO writer (undo.writer unset)'
      using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    if new.store_id <> old.store_id then
      raise exception 'store_id is immutable' using errcode = 'P0001';
    end if;
    new.revision := old.revision + 1;
  else
    new.revision := 1;
  end if;
  new.last_actor := undo_writer();
  new.last_action_id := undo_action();
  new.updated_at := now();
  return new;
end $$;

create or replace function undo_component_journal() returns trigger language plpgsql as $$
declare
  ctype text; cid text; ckey text; vbefore jsonb; vafter jsonb; rbefore bigint;
begin
  if tg_table_name = 'product_prices' then
    ctype := 'price'; cid := new.product_id; ckey := 'price';
    vafter := jsonb_build_object('amount_minor', new.amount_minor, 'currency', new.currency);
    if tg_op = 'UPDATE' then vbefore := jsonb_build_object('amount_minor', old.amount_minor, 'currency', old.currency); end if;
  elsif tg_table_name = 'product_content' then
    ctype := 'content'; cid := new.product_id; ckey := new.component_key;
    vafter := to_jsonb(new.value);
    if tg_op = 'UPDATE' then vbefore := to_jsonb(old.value); end if;
  else
    ctype := 'slot'; cid := new.slot_id; ckey := new.slot_kind;
    vafter := new.content;
    if tg_op = 'UPDATE' then vbefore := old.content; end if;
  end if;
  if tg_op = 'UPDATE' then rbefore := old.revision; end if;
  insert into component_writes(store_id, component_type, component_id, component_key, revision_before, revision_after,
                               value_before, value_after, actor, action_id)
  values (new.store_id, ctype, cid, ckey, rbefore, new.revision, vbefore, vafter, undo_writer(), undo_action());
  return null;
end $$;

create trigger product_prices_guard before insert or update on product_prices
  for each row execute function undo_component_guard();
create trigger product_prices_journal after insert or update on product_prices
  for each row execute function undo_component_journal();
create trigger product_content_guard before insert or update on product_content
  for each row execute function undo_component_guard();
create trigger product_content_journal after insert or update on product_content
  for each row execute function undo_component_journal();
create trigger store_slots_guard before insert or update on store_slots
  for each row execute function undo_component_guard();
create trigger store_slots_journal after insert or update on store_slots
  for each row execute function undo_component_journal();

-- Rollouts, actions, recorded changes ---------------------------------------
create table rollouts (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  goal text not null,
  proposal jsonb not null,
  proposal_hash text not null,
  state text not null check (state in ('awaiting_approval','approved','executed','rejected')),
  needs_review boolean not null,
  created_by text not null,
  approval_id text,
  created_at timestamptz not null default now(),
  executed_at timestamptz
);
create index rollouts_store_idx on rollouts(store_id, created_at desc);

create table actions (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  rollout_id text references rollouts(id) on delete cascade,
  kind text not null check (kind in ('rollout','compensation','operator_edit','corrective')),
  actor text not null,
  idempotency_key text,
  request_hash text,
  committed_at timestamptz not null default now()
);

create table action_changes (
  id text primary key,
  action_id text not null references actions(id) on delete cascade,
  rollout_id text not null references rollouts(id) on delete cascade,
  store_id text not null references stores(id) on delete cascade,
  component_type text not null check (component_type in ('price','content','slot')),
  component_id text not null,
  component_key text not null,
  product_id text,
  scope_labels text[] not null,
  group_id text,
  before_value jsonb not null,
  after_value jsonb not null,
  before_revision bigint not null,
  after_revision bigint not null,
  recovery_status text not null default 'active' check (recovery_status in ('active','reverted')),
  reverted_by text,
  reverted_at timestamptz,
  committed_at timestamptz not null default now(),
  unique (rollout_id, component_type, component_id, component_key)
);
create index action_changes_component on action_changes(store_id, component_type, component_id, component_key);

create or replace function undo_action_changes_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('undo.reset_store', true) = old.store_id then return old; end if;
    raise exception 'action_changes are append-only' using errcode = 'P0001';
  end if;
  if (new.before_value, new.after_value, new.before_revision, new.after_revision, new.component_type,
      new.component_id, new.component_key, new.rollout_id, new.store_id, new.scope_labels)
     is distinct from
     (old.before_value, old.after_value, old.before_revision, old.after_revision, old.component_type,
      old.component_id, old.component_key, old.rollout_id, old.store_id, old.scope_labels) then
    raise exception 'recorded change history is immutable' using errcode = 'P0001';
  end if;
  if old.recovery_status = 'reverted' and new.recovery_status <> 'reverted' then
    raise exception 'a reverted change cannot be un-reverted' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger action_changes_immutable before update or delete on action_changes
  for each row execute function undo_action_changes_immutable();

-- Approvals ------------------------------------------------------------------
create table approval_requests (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  kind text not null check (kind in ('launch','recovery')),
  subject_id text not null,
  subject_hash text not null,
  owner_principal_id text not null references principals(id),
  token_hash text not null unique,
  case_id text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create table approvals (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  principal_id text not null references principals(id),
  kind text not null check (kind in ('launch','recovery')),
  subject_id text not null,
  subject_hash text not null,
  decided_via text not null,
  request_id text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz
);
create index approvals_subject on approvals(store_id, kind, subject_id);

-- Recovery plans and attempts --------------------------------------------------
create table recovery_plans (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  rollout_id text not null references rollouts(id) on delete cascade,
  selected_change_ids text[] not null,
  keep_current_change_ids text[] not null default '{}',
  items jsonb not null,
  plan_hash text not null,
  order_snapshot_hash text not null,
  order_cutoff_seq bigint not null,
  case_id text,
  intent_note text,
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'open' check (status in ('open','applied','expired'))
);

create table recovery_attempts (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  plan_id text not null references recovery_plans(id) on delete cascade,
  status text not null check (status in ('fully_reverted','partially_reverted','resolved_with_exceptions','blocked')),
  result jsonb not null,
  authorization_ref text not null,
  actor text not null,
  created_at timestamptz not null default now()
);

-- Orders (immutable checkout snapshots) ------------------------------------------
create table orders (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  seq bigserial unique,
  customer_principal_id text references principals(id),
  status text not null check (status in ('placed_test','imported')),
  total_minor integer not null check (total_minor >= 0),
  currency char(3) not null,
  is_test boolean not null default true,
  created_at timestamptz not null default now()
);
create index orders_store_seq on orders(store_id, seq);

create table order_lines (
  id text primary key,
  order_id text not null references orders(id) on delete cascade,
  store_id text not null references stores(id) on delete cascade,
  product_id text not null references products(id) on delete cascade,
  sku text not null,
  quantity integer not null check (quantity > 0 and quantity <= 20),
  unit_amount_minor integer not null check (unit_amount_minor > 0),
  currency char(3) not null,
  source_price_revision bigint,
  source_change_id text,
  source_rollout_id text
);
create index order_lines_source on order_lines(store_id, source_change_id);

create or replace function undo_orders_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('undo.reset_store', true) = old.store_id then
    return old;
  end if;
  raise exception 'order snapshots are immutable' using errcode = 'P0001';
end $$;
create trigger orders_immutable before update or delete on orders
  for each row execute function undo_orders_immutable();
create trigger order_lines_immutable before update or delete on order_lines
  for each row execute function undo_orders_immutable();

create table order_access_grants (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  customer_principal_id text not null references principals(id),
  order_id text not null references orders(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create table impact_reports (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  rollout_id text not null,
  selection_hash text not null,
  cutoff_seq bigint not null,
  viewer_role text not null,
  report jsonb not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

-- Cases, inbox, outbox ------------------------------------------------------------
create table cases (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  role text not null check (role in ('owner','customer')),
  principal_id text not null references principals(id),
  channel text not null check (channel in ('imessage','email','sms','web')),
  thread_ref text,
  intent_version integer not null default 0,
  rollout_id text,
  plan_id text,
  state text not null default 'open' check (state in ('open','awaiting_owner','awaiting_approval','resolved','needs_clarification','failed')),
  summary text not null default '',
  run_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table case_events (
  id bigserial primary key,
  case_id text not null references cases(id) on delete cascade,
  kind text not null,
  data jsonb not null,
  at timestamptz not null default now()
);

create table inbox_events (
  id text primary key,
  provider text not null check (provider in ('inkbox','undo')),
  provider_event_id text not null,
  event_type text not null,
  payload_hash text not null,
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued','processing','handled','rejected','needs_clarification','failed')),
  attempts integer not null default 0,
  lease_until timestamptz,
  case_id text,
  error text,
  received_at timestamptz not null default now(),
  handled_at timestamptz,
  unique (provider, provider_event_id)
);
create index inbox_pending on inbox_events(status, received_at) where status in ('queued','processing');

create table outbox_messages (
  id text primary key,
  case_id text references cases(id) on delete set null,
  store_id text,
  dedupe_key text not null unique,
  channel text not null check (channel in ('imessage','email')),
  recipient_principal_id text not null references principals(id),
  purpose text not null,
  body text not null check (char_length(body) <= 4000),
  in_reply_to text,
  subject text,
  status text not null default 'pending' check (status in ('pending','sending','accepted','delivered','failed','outcome_unknown')),
  provider_message_id text,
  attempts integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index outbox_pending on outbox_messages(status, created_at) where status in ('pending','sending');

create table idempotency_keys (
  store_id text not null,
  scope text not null,
  key text not null,
  request_hash text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (store_id, scope, key)
);

create table audit_events (
  id bigserial primary key,
  store_id text,
  actor text not null,
  kind text not null,
  data jsonb not null,
  correlation_id text,
  at timestamptz not null default now()
);

create or replace function undo_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('undo.reset_store', true) = old.store_id then return old; end if;
  raise exception '% is append-only', tg_table_name using errcode = 'P0001';
end $$;
create trigger audit_events_append_only before update or delete on audit_events
  for each row execute function undo_append_only();
create trigger component_writes_append_only before update or delete on component_writes
  for each row execute function undo_append_only();

create table usage_counters (
  name text primary key,
  used integer not null default 0,
  cap integer not null
);
