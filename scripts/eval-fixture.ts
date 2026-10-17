/**
 * Deterministic evaluation-store fixture (Armature + eval:agent): reset store_eval, execute the fixed
 * weekend launch through the real service layer (evaluator proposes, eval owner approves), then the
 * same post-launch activity. No model involved, so every run starts from identical state.
 */
import { approveAsOwner } from "../src/approvals/approvals.js";
import { mintToken, verifyToken } from "../src/auth/principals.js";
import { operatorEdit } from "../src/catalog/operator.js";
import { closePool, query, withTx } from "../src/db/pool.js";
import { evalStoreSpec, productId, resetStore, weekendLaunchProposal } from "../src/fixtures/demo.js";
import { newId } from "../src/lib/util.js";
import { checkout } from "../src/orders/checkout.js";
import { type Proposal, undoExecute } from "../src/recovery/execute.js";

export async function evalFixture(): Promise<{ rolloutId: string }> {
  const S = "store_eval";
  await resetStore(evalStoreSpec());
  const p = async (id: string, role: "evaluator" | "owner" | "operator" | "customer") =>
    verifyToken((await withTx((tx) => mintToken(tx, { principalId: id, storeId: S, role, label: "eval-fixture", ttlMinutes: 10 }))).token);
  const evaluator = await p("pr_evaluator", "evaluator");
  const operator = await p("pr_eval_operator", "operator");
  const customer = await p("pr_eval_customer", "customer");
  const proposed = (await undoExecute(evaluator, { proposal: weekendLaunchProposal(S) as unknown as Proposal, idempotency_key: newId("fx") })) as { rollout_id: string; proposal_hash: string };
  await approveAsOwner("pr_eval_owner", S, "launch", proposed.rollout_id, proposed.proposal_hash, "eval_fixture_owner");
  await undoExecute(evaluator, { rollout_id: proposed.rollout_id, proposal_hash: proposed.proposal_hash, idempotency_key: newId("fx") });
  await checkout(customer, { items: [{ sku: "PRM-JKT", quantity: 1 }], idempotency_key: newId("fx") });
  await checkout(customer, { items: [{ sku: "COR-TOT", quantity: 2 }], idempotency_key: newId("fx") });
  const rev = async (key: "sizing_info" | "price", pid: string) =>
    key === "price"
      ? Number((await query(`select revision from product_prices where product_id=$1`, [pid])).rows[0].revision)
      : Number((await query(`select revision from product_content where product_id=$1 and component_key='sizing_info'`, [pid])).rows[0].revision);
  await operatorEdit(operator, { sku: "PRM-JKT", component: "sizing_info", text: "Runs small: size up if between sizes. Model is 6'0\" wearing L.", expected_revision: await rev("sizing_info", productId(S, "jacket")), idempotency_key: newId("fx") });
  await operatorEdit(operator, { sku: "PRM-SHO", component: "price", amount_minor: 13900, expected_revision: await rev("price", productId(S, "shoes")), idempotency_key: newId("fx") });
  await query(`update api_tokens set revoked_at = now() where label = 'eval-fixture' and revoked_at is null`);
  return { rolloutId: proposed.rollout_id };
}

if (process.argv[1]?.endsWith("eval-fixture.ts")) {
  evalFixture()
    .then((r) => console.log(`store_eval ready: rollout ${r.rolloutId} executed; jacket order linked, tote order unlinked, shoe $139 conflict, jacket sizing edited`))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
