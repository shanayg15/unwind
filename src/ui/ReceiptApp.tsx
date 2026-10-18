/** RecoveryReceipt UI shared by the recovery-plan (undo_preview) and recovery-receipt (undo_verify) views. */
import { ModelContext, ThemeProvider, useCallTool, useToolContext } from "mcp-use/react";
import { useMemo, useState } from "react";
import "./receipt.css";

type Row = {
  change_id: string | null;
  label: string;
  component: string;
  tags: string[];
  original: string | null;
  launch: string | null;
  current: string | null;
  current_revision: number | null;
  status: string;
  selected: boolean;
};
type Receipt = {
  mode: "plan" | "recovery";
  store: string;
  rollout_id: string;
  rollout_goal: string;
  plan_id: string;
  plan_hash: string;
  plan_expires_at: string;
  recovery_id: string | null;
  recovery_status: string | null;
  approval: { state: string; detail: string };
  rows: Row[];
  preserved: Row[];
  independent: Row[];
  impact: { direct: number; linked_unselected: number; temporal_only: number; unknown: number; as_of_seq: number };
  communications: Array<{ channel: string; purpose: string; status: string }>;
  allocations?: Allocation[];
  generated_at: string;
};
type Allocation = {
  change_id: string;
  title: string;
  gift: string;
  state: string;
  initially_allocated: number;
  committed_to_orders: number;
  accepted_orders: number;
  held_unallocated: number;
  released: number;
  available_now: number;
  outcome: Array<{ label: string; quantity: number | null }>;
};

const TONE: Record<string, string> = {
  eligible: "ok",
  restored: "ok",
  retired: "ok",
  kept_at_launch_value: "ok",
  preserved_not_written_by_recovery: "ok",
  not_part_of_rollout: "muted",
  conflict: "bad",
  withheld_conflict: "bad",
  withheld_group: "bad",
  withheld_changed_since_preview: "bad",
  kept_by_new_decision: "warn",
  already_reverted: "muted",
  changed_by_another_writer: "warn",
};

function Badge({ status }: { status: string }) {
  return <span className={`badge ${TONE[status] ?? "muted"}`}>{status.replaceAll("_", " ")}</span>;
}

function Table({ rows, showOriginal }: { rows: Row[]; showOriginal: boolean }) {
  if (!rows.length) return <p className="muted small">None.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Component</th>
          {showOriginal && <th>Before launch</th>}
          <th>Launch</th>
          <th>Current</th>
          <th>State</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.change_id ?? r.label}`}>
            <td>
              <div>{r.label}</div>
              <div className="tags">{r.tags.slice(0, 3).map((t) => <span key={t} className="tag">{t}</span>)}</div>
            </td>
            {showOriginal && <td>{r.original ?? "—"}</td>}
            <td>{r.launch ?? "—"}</td>
            <td>
              {r.current ?? "—"}
              {r.current_revision !== null && <div className="muted small">rev {r.current_revision}</div>}
            </td>
            <td>
              <Badge status={r.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One cell per unit set aside for the experiment: on an accepted order, still held, or released. */
function GiftStock({ a, mode }: { a: Allocation; mode: "plan" | "recovery" }) {
  const cells = [
    ...Array.from({ length: a.committed_to_orders }, () => "order"),
    ...Array.from({ length: a.held_unallocated }, () => (mode === "plan" ? "releasable" : "held")),
    ...Array.from({ length: a.released }, () => "released"),
  ];
  return (
    <section className="card gift">
      <h3>
        {a.title} · {a.gift}
      </h3>
      <div className="units" role="img" aria-label={`${a.initially_allocated} set aside: ${a.committed_to_orders} on accepted orders, ${a.held_unallocated} held, ${a.released} released`}>
        {cells.map((c, i) => (
          <span key={i} className={`unit ${c}`} />
        ))}
      </div>
      <ul className="kv">
        <li>
          <span>Set aside for the offer</span>
          <b>{a.initially_allocated}</b>
        </li>
        <li>
          <span>Kept on {a.accepted_orders} accepted order{a.accepted_orders === 1 ? "" : "s"}</span>
          <b>{a.committed_to_orders}</b>
        </li>
        <li>
          <span>{mode === "plan" ? "Released to stock on apply" : "Still held by the offer"}</span>
          <b>{a.held_unallocated}</b>
        </li>
        <li>
          <span>Released to available stock</span>
          <b>{a.released}</b>
        </li>
        <li>
          <span>Available for ordinary sale now</span>
          <b>{a.available_now}</b>
        </li>
      </ul>
      <p className="small muted">Offer {a.state}. Accepted orders keep their gift; only units the offer still holds are released.</p>
    </section>
  );
}

function newKey(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ReceiptApp() {
  const view = useToolContext<"undo_verify">();
  const verify = useCallTool("undo_verify");
  const apply = useCallTool("undo_apply");
  const [override, setOverride] = useState<Receipt | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const initial = view.status === "ready" ? ((view.toolOutput as { receipt?: Receipt | null })?.receipt ?? null) : null;
  const receipt = override ?? initial;
  const expired = receipt ? receipt.mode === "plan" && new Date(receipt.plan_expires_at).getTime() < Date.now() : false;
  const partial = receipt?.recovery_status === "partially_reverted" || receipt?.recovery_status === "blocked";

  const summary = useMemo(() => {
    if (!receipt) return "";
    const restored = receipt.rows.filter((r) => r.status === "restored" || r.status === "eligible").length;
    const conflicts = receipt.rows.filter((r) => r.status.includes("conflict") || r.status.startsWith("withheld")).length;
    const kept = receipt.rows.filter((r) => r.status === "kept_by_new_decision").length;
    const gifts = (receipt.allocations ?? []).map((a) => ` Gift offer ${a.title}: ${a.initially_allocated} set aside, ${a.committed_to_orders} kept on accepted orders, ${a.held_unallocated} held, ${a.released} released.`).join("");
    return `${receipt.mode === "plan" ? "Plan" : "Recovery"} for rollout ${receipt.rollout_id}: ${restored} ${receipt.mode === "plan" ? "eligible" : "restored"}, ${conflicts} conflict/withheld, ${kept} kept as owner exception; impact ${receipt.impact.direct} directly linked order(s).${gifts}`;
  }, [receipt]);

  async function refresh() {
    if (!receipt) return;
    setActionMsg(null);
    try {
      const res = await verify.callTool({ plan_id: receipt.plan_id });
      const next = (res.structuredContent as { receipt?: Receipt | null })?.receipt ?? null;
      if (next) setOverride(next);
      if (next && next.plan_hash !== receipt.plan_hash) setActionMsg("Plan changed since this view loaded.");
    } catch (e) {
      setActionMsg((e as Error).message);
    }
  }

  async function applyPlan() {
    if (!receipt) return;
    setActionMsg(null);
    try {
      await apply.callTool({ plan_id: receipt.plan_id, plan_hash: receipt.plan_hash, idempotency_key: newKey("app") });
      await refresh();
    } catch (e) {
      const msg = (e as Error).message;
      setActionMsg(/approval_required/.test(msg) ? "Owner confirmation of this exact plan hash is required. The owner approves from the link sent to their phone (or an owner credential)." : msg);
    }
  }

  if (view.status === "pending") {
    return (
      <ThemeProvider>
        <div className="shell">
          <div className="skeleton" />
          <p className="muted">Loading recovery receipt…</p>
        </div>
      </ThemeProvider>
    );
  }
  if (view.status === "error") {
    return (
      <ThemeProvider>
        <div className="shell">
          <div className="alert bad">Could not load the receipt: {view.error.message}</div>
        </div>
      </ThemeProvider>
    );
  }
  if (!receipt) {
    return (
      <ThemeProvider>
        <div className="shell">
          <p className="muted">No recovery plan to show for this result.</p>
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <ModelContext content={summary} />
      <div className="shell">
        <header>
          <div>
            <div className="eyebrow">RecoveryReceipt · {receipt.store}</div>
            <h1>{receipt.mode === "plan" ? "Recovery plan" : "Recovery receipt"}</h1>
            <p className="muted small">{receipt.rollout_goal}</p>
          </div>
          <div className="right">
            {receipt.recovery_status ? <Badge status={receipt.recovery_status} /> : <span className="badge muted">preview · nothing written</span>}
            <div className="muted small mono">plan {receipt.plan_hash.slice(0, 12)}…</div>
          </div>
        </header>

        {expired && <div className="alert warn">This plan expired. It can no longer be applied; preview again so newer edits are never overwritten.</div>}
        {partial && <div className="alert warn">Partial result: some selected changes were withheld rather than overwrite later edits.</div>}
        {actionMsg && <div className="alert">{actionMsg}</div>}

        {(receipt.allocations ?? []).length > 0 && (
          <>
            <h2>Gift stock</h2>
            <div className="grid tight">
              {receipt.allocations!.map((a) => (
                <GiftStock key={a.change_id} a={a} mode={receipt.mode} />
              ))}
            </div>
          </>
        )}

        <h2>Selected changes</h2>
        <Table rows={receipt.rows} showOriginal />

        <h2>Kept from the launch (not selected)</h2>
        <Table rows={receipt.preserved} showOriginal={false} />

        <h2>Independent edits on the same products</h2>
        <Table rows={receipt.independent} showOriginal={false} />

        <div className="grid">
          <section className="card">
            <h3>Order impact</h3>
            <p className="small muted">From checkout price provenance, as of order #{receipt.impact.as_of_seq}. Orders are never modified.</p>
            <ul className="kv">
              <li>
                <span>Used a price from this selection</span>
                <b>{receipt.impact.direct}</b>
              </li>
              <li>
                <span>Linked to an unselected change</span>
                <b>{receipt.impact.linked_unselected}</b>
              </li>
              <li>
                <span>Same period, no link (not attributed)</span>
                <b>{receipt.impact.temporal_only}</b>
              </li>
              <li>
                <span>Unknown provenance</span>
                <b>{receipt.impact.unknown}</b>
              </li>
            </ul>
          </section>
          <section className="card">
            <h3>Approval</h3>
            <p>
              <Badge status={receipt.approval.state} />
            </p>
            <p className="small muted">{receipt.approval.detail}</p>
            <h3>Communications</h3>
            {receipt.communications.length ? (
              <ul className="kv">
                {receipt.communications.map((m, i) => (
                  <li key={i}>
                    <span>
                      {m.channel === "imessage" ? "Owner text" : "Customer email"} · {m.purpose.replaceAll("_", " ")}
                    </span>
                    <b>{m.status}</b>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted">No messages for this case yet.</p>
            )}
          </section>
        </div>

        <footer>
          <button onClick={() => void refresh()} disabled={verify.isPending}>
            {verify.isPending ? "Refreshing…" : "Refresh from store"}
          </button>
          {receipt.mode === "plan" && !expired && (
            <button className="primary" onClick={() => void applyPlan()} disabled={apply.isPending}>
              {apply.isPending ? "Applying…" : "Apply this plan"}
            </button>
          )}
          <span className="muted small">Checked {new Date(receipt.generated_at).toLocaleString()}</span>
        </footer>
      </div>
    </ThemeProvider>
  );
}
