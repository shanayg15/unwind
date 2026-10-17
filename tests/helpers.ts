import { type Principal, verifyToken } from "../src/auth/principals.js";
import { approveAsOwner } from "../src/approvals/approvals.js";
import { query } from "../src/db/pool.js";
import { demoStoreSpec, ensureTokens, evalStoreSpec, resetStore, weekendLaunchProposal } from "../src/fixtures/demo.js";
import { undoExecute, type Proposal } from "../src/recovery/execute.js";
import { newId } from "../src/lib/util.js";
import { mintToken } from "../src/auth/principals.js";
import { withTx } from "../src/db/pool.js";

export interface Actors {
  owner: Principal;
  operator: Principal;
  agent: Principal;
  customerA: Principal;
  customerB: Principal;
  evaluator: Principal;
}

/** Fresh tagged demo + eval stores and real token-verified principals (no stubbed auth). */
export async function freshStores(): Promise<Actors> {
  const demo = demoStoreSpec();
  const ev = evalStoreSpec();
  await resetStore(demo);
  await resetStore(ev);
  const mint = async (store: string, principalId: string, role: Principal["role"]) => {
    const { token } = await withTx((tx) => mintToken(tx, { principalId, storeId: store, role, label: "test", ttlMinutes: 60 }));
    return verifyToken(token);
  };
  await ensureTokens(demo);
  await ensureTokens(ev);
  return {
    owner: await mint("store_demo", "pr_owner", "owner"),
    operator: await mint("store_demo", "pr_operator", "operator"),
    agent: await mint("store_demo", "pr_agent", "agent"),
    customerA: await mint("store_demo", "pr_customer_a", "customer"),
    customerB: await mint("store_demo", "pr_customer_b", "customer"),
    evaluator: await mint("store_eval", "pr_evaluator", "evaluator"),
  };
}

export function key(label: string): string {
  return `${label}-${newId("k")}`;
}

/** Agent proposes, owner approves the exact hash, agent executes. */
export async function launch(a: Actors, proposal: Proposal = weekendLaunchProposal("store_demo") as unknown as Proposal) {
  const proposed = (await undoExecute(a.agent, { proposal, idempotency_key: key("prop") })) as { rollout_id: string; proposal_hash: string };
  await approveAsOwner(a.owner.principalId, "store_demo", "launch", proposed.rollout_id, proposed.proposal_hash, "test_owner_session");
  const executed = (await undoExecute(a.agent, { rollout_id: proposed.rollout_id, proposal_hash: proposed.proposal_hash, idempotency_key: key("exec") })) as {
    status: string;
    rollout_id: string;
    changes: Array<{ change_id: string; component: string; labels: string[]; after_revision: number }>;
  };
  return executed;
}

export async function component(storeId: string, table: "price" | "promo" | "sizing", productId: string) {
  if (table === "price") return (await query(`select amount_minor, revision from product_prices where store_id=$1 and product_id=$2`, [storeId, productId])).rows[0];
  const k = table === "promo" ? "promotional_copy" : "sizing_info";
  return (await query(`select value, revision, last_actor from product_content where store_id=$1 and product_id=$2 and component_key=$3`, [storeId, productId, k])).rows[0];
}
