-- Purchase-aware rollback (addendum, 2026-10-17): one gift-promotion adapter + order-dependency contract.
-- Stock buckets: available = on_hand - held - committed. held is owned by campaign allocations, committed
-- by accepted orders (purchased lines + gift entitlements). Every writer goes through the UNDO writer.

alter table inventory add column held integer not null default 0 check (held >= 0);
alter table inventory add column committed integer not null default 0 check (committed >= 0);
alter table inventory add column revision bigint not null default 1;
-- Orders placed before this migration committed no stock; account for them so the books reconcile.
update inventory i set committed = coalesce((select sum(l.quantity) from order_lines l where l.product_id = i.product_id), 0);
update inventory set on_hand = greatest(on_hand, committed);
alter table inventory add constraint inventory_balance check (held + committed <= on_hand);

create or replace function undo_inventory_guard() returns trigger language plpgsql as $$
begin
  if undo_writer() is null then
    raise exception 'inventory writes must go through the UNDO writer (undo.writer unset)' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    if new.store_id <> old.store_id or new.product_id <> old.product_id then
      raise exception 'inventory identity is immutable' using errcode = 'P0001';
    end if;
    new.revision := old.revision + 1;
  end if;
  return new;
end $$;
create trigger inventory_guard before insert or update on inventory for each row execute function undo_inventory_guard();

-- Versioned gift promotion. Terms, gift and cap are immutable once created; only active -> retired.
create table promotions (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  rollout_id text not null references rollouts(id) on delete cascade,
  version integer not null default 1,
  title text not null,
  gift_product_id text not null references products(id) on delete cascade,
  qualifying_collection text not null check (qualifying_collection in ('premium','clearance','core')),
  gift_quantity integer not null default 1 check (gift_quantity = 1),
  cap integer not null check (cap between 1 and 100),
  terms text not null check (char_length(terms) <= 400),
  terms_hash text not null,
  state text not null check (state in ('active','retired')),
  revision bigint not null default 1,
  created_action_id text not null,
  retired_action_id text,
  retired_by_recovery text,
  retired_at timestamptz,
  created_at timestamptz not null default now()
);
create index promotions_store on promotions(store_id, state);
create unique index promotions_one_active_per_gift on promotions(store_id, gift_product_id) where state = 'active';

create or replace function undo_promotion_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('undo.reset_store', true) = old.store_id then return old; end if;
    raise exception 'promotion versions are never deleted' using errcode = 'P0001';
  end if;
  if undo_writer() is null then
    raise exception 'promotion writes must go through the UNDO writer' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    if (new.store_id, new.rollout_id, new.version, new.title, new.gift_product_id, new.qualifying_collection, new.gift_quantity, new.cap, new.terms, new.terms_hash, new.created_action_id)
       is distinct from
       (old.store_id, old.rollout_id, old.version, old.title, old.gift_product_id, old.qualifying_collection, old.gift_quantity, old.cap, old.terms, old.terms_hash, old.created_action_id) then
      raise exception 'promotion terms are immutable; retire and create a new version instead' using errcode = 'P0001';
    end if;
    if old.state = 'retired' then
      raise exception 'a retired promotion cannot be changed or re-activated' using errcode = 'P0001';
    end if;
    new.revision := old.revision + 1;
  end if;
  return new;
end $$;
create trigger promotions_guard before insert or update or delete on promotions for each row execute function undo_promotion_guard();

-- Units set aside for one promotion version. remaining is campaign-owned; it can only go down.
create table campaign_allocations (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  promotion_id text not null references promotions(id) on delete cascade,
  product_id text not null references products(id) on delete cascade,
  location text not null default 'main',
  initial_quantity integer not null check (initial_quantity > 0),
  remaining_quantity integer not null check (remaining_quantity >= 0),
  released_quantity integer not null default 0 check (released_quantity >= 0),
  state text not null check (state in ('holding','released')),
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  check (remaining_quantity + released_quantity <= initial_quantity),
  unique (promotion_id, product_id, location)
);

create or replace function undo_allocation_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('undo.reset_store', true) = old.store_id then return old; end if;
    raise exception 'allocations are never deleted' using errcode = 'P0001';
  end if;
  if undo_writer() is null then
    raise exception 'allocation writes must go through the UNDO writer' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    if (new.store_id, new.promotion_id, new.product_id, new.location, new.initial_quantity) is distinct from (old.store_id, old.promotion_id, old.product_id, old.location, old.initial_quantity) then
      raise exception 'allocation identity is immutable' using errcode = 'P0001';
    end if;
    if new.remaining_quantity > old.remaining_quantity then
      raise exception 'campaign-held quantity can only decrease (gift commitments and releases)' using errcode = 'P0001';
    end if;
    if old.state = 'released' then
      raise exception 'a released allocation is final' using errcode = 'P0001';
    end if;
    new.revision := old.revision + 1;
  end if;
  return new;
end $$;
create trigger campaign_allocations_guard before insert or update or delete on campaign_allocations for each row execute function undo_allocation_guard();

-- Accepted gift promise on a test order: immutable snapshot of the gift line (zero price) and its terms.
create table order_entitlements (
  id text primary key,
  order_id text not null references orders(id) on delete cascade,
  store_id text not null references stores(id) on delete cascade,
  promotion_id text not null references promotions(id) on delete cascade,
  promotion_version integer not null,
  allocation_id text not null references campaign_allocations(id) on delete cascade,
  gift_product_id text not null references products(id) on delete cascade,
  gift_sku text not null,
  gift_title text not null,
  quantity integer not null check (quantity = 1),
  unit_amount_minor integer not null default 0 check (unit_amount_minor = 0),
  terms text not null,
  terms_hash text not null,
  accepted_at timestamptz not null default now(),
  unique (order_id, promotion_id, gift_product_id)
);
create index order_entitlements_promotion on order_entitlements(promotion_id);
create trigger order_entitlements_immutable before update or delete on order_entitlements
  for each row execute function undo_orders_immutable();

-- Typed quantity transfers with the balances they produced (append-only journal).
create table inventory_moves (
  id bigserial primary key,
  store_id text not null,
  product_id text not null,
  kind text not null check (kind in ('reserve_campaign','commit_gift','commit_order','release_remaining')),
  quantity integer not null check (quantity > 0),
  from_bucket text not null check (from_bucket in ('available','held')),
  to_bucket text not null check (to_bucket in ('available','held','committed')),
  promotion_id text,
  allocation_id text,
  order_id text,
  action_id text,
  recovery_id text,
  idempotency_ref text,
  actor text not null,
  balances_after jsonb not null,
  at timestamptz not null default now()
);
create index inventory_moves_alloc on inventory_moves(allocation_id, kind);
create trigger inventory_moves_append_only before update or delete on inventory_moves
  for each row execute function undo_append_only();

-- Promotions are recorded rollout effects alongside price/content/slot changes.
alter table action_changes drop constraint action_changes_component_type_check;
alter table action_changes add constraint action_changes_component_type_check check (component_type in ('price','content','slot','promotion'));
-- A plan whose order dependencies moved is superseded by a fresh preview (never silently re-scoped).
alter table recovery_plans drop constraint recovery_plans_status_check;
alter table recovery_plans add constraint recovery_plans_status_check check (status in ('open','applied','expired','superseded'));
