import { useDeferredValue, useMemo, useState } from "react";
import type { HistoryEntry } from "@cashu/coco-core";
import type { UseBalancesResult } from "../hooks/useBalances";
import type { UseEventLogResult } from "../hooks/useEventLog";
import type { UseHistoryResult } from "../hooks/useHistory";
import type { UseOperationsResult } from "../hooks/useOperations";
import { formatDateTime, formatSats, getMintLabel } from "../lib/format";

type DebugPanelProps = {
  balancesState: UseBalancesResult;
  historyState: UseHistoryResult;
  operationsState: UseOperationsResult;
  eventLogState: UseEventLogResult;
  onRefreshAll: () => Promise<void>;
};

function renderHistoryState(entry: HistoryEntry): string {
  if (entry.type === "receive") {
    return "received";
  }

  return entry.state;
}

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function DebugPanel({
  balancesState,
  historyState,
  operationsState,
  eventLogState,
  onRefreshAll,
}: DebugPanelProps) {
  const [filter, setFilter] = useState("");
  const deferredFilter = useDeferredValue(filter.trim().toLowerCase());

  const filteredLogs = useMemo(() => {
    if (!deferredFilter) {
      return eventLogState.entries;
    }

    return eventLogState.entries.filter(
      (entry) =>
        entry.event.toLowerCase().includes(deferredFilter) ||
        entry.payload.toLowerCase().includes(deferredFilter),
    );
  }, [deferredFilter, eventLogState.entries]);

  return (
    <section className="panel-stack">
      <div className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Debug panel</p>
            <h2>Proof inventory, operation state, history, and live events</h2>
          </div>
          <div className="button-row">
            <button type="button" className="btn btn--secondary" onClick={() => void onRefreshAll()}>
              Refresh everything
            </button>
            <button type="button" className="btn btn--ghost" onClick={eventLogState.clear}>
              Clear log
            </button>
          </div>
        </div>

        <div className="stat-grid">
          <div className="stat-card">
            <span>Spendable</span>
            <strong>{formatSats(balancesState.totalSpendable)}</strong>
          </div>
          <div className="stat-card">
            <span>Reserved</span>
            <strong>{formatSats(balancesState.totalReserved)}</strong>
          </div>
          <div className="stat-card">
            <span>Inflight</span>
            <strong>{formatSats(balancesState.totalInflight)}</strong>
          </div>
          <div className="stat-card">
            <span>Controlled</span>
            <strong>{formatSats(balancesState.totalControlled)}</strong>
          </div>
        </div>
      </div>

      <div className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Proof inventory</p>
            <h3>Per-mint balance and proof accounting</h3>
          </div>
        </div>

        <div className="key-value-grid">
          {Object.values(balancesState.byMint).map((balance) => (
            <div key={balance.mintUrl}>
              <span>{getMintLabel(balance.mintUrl)}</span>
              <strong>
                {formatSats(balance.spendable)} / {formatSats(balance.reserved)} / {formatSats(balance.inflight)}
              </strong>
            </div>
          ))}
        </div>
      </div>

      <div className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Operation queues</p>
            <h3>Prepared and in-flight saga state</h3>
          </div>
        </div>

        <details className="details-panel" open>
          <summary>
            Send operations ({operationsState.send.prepared.length} prepared, {operationsState.send.inFlight.length} in
            flight)
          </summary>
          <pre className="code-block">
            {stringify({
              prepared: operationsState.send.prepared,
              inFlight: operationsState.send.inFlight,
            })}
          </pre>
        </details>

        <details className="details-panel">
          <summary>
            Melt operations ({operationsState.melt.prepared.length} prepared, {operationsState.melt.inFlight.length} in
            flight)
          </summary>
          <pre className="code-block">
            {stringify({
              prepared: operationsState.melt.prepared,
              inFlight: operationsState.melt.inFlight,
            })}
          </pre>
        </details>

        <details className="details-panel">
          <summary>
            Receive operations ({operationsState.receive.prepared.length} prepared, {operationsState.receive.inFlight.length} in
            flight)
          </summary>
          <pre className="code-block">
            {stringify({
              prepared: operationsState.receive.prepared,
              inFlight: operationsState.receive.inFlight,
            })}
          </pre>
        </details>

        <details className="details-panel">
          <summary>
            Mint operations ({operationsState.mint.pending.length} pending, {operationsState.mint.inFlight.length} in
            flight)
          </summary>
          <pre className="code-block">
            {stringify({
              pending: operationsState.mint.pending,
              inFlight: operationsState.mint.inFlight,
            })}
          </pre>
        </details>
      </div>

      <div className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">History</p>
            <h3>Recent wallet activity</h3>
          </div>
        </div>

        {historyState.entries.length === 0 ? (
          <div className="empty-state">
            <h3>No history yet</h3>
            <p>Run any wallet flow to populate the transaction history.</p>
          </div>
        ) : (
          <div className="history-list">
            {historyState.entries.map((entry) => (
              <article key={entry.id} className="history-row">
                <div>
                  <strong>{entry.type}</strong>
                  <span>{getMintLabel(entry.mintUrl)}</span>
                </div>
                <div>
                  <strong>{formatSats(entry.amount)}</strong>
                  <span>{renderHistoryState(entry)}</span>
                </div>
                <div>
                  <strong>{formatDateTime(entry.createdAt)}</strong>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Live event log</p>
            <h3>Wallet runtime bus</h3>
          </div>
          <label className="field field--compact">
            <span className="field__label">Filter</span>
            <input
              className="input"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter by event or payload"
            />
          </label>
        </div>

        <div className="log-list">
          {filteredLogs.map((entry) => (
            <article key={entry.id} className="log-row">
              <div className="log-row__meta">
                <strong>{entry.event}</strong>
                <span>{entry.timestamp}</span>
              </div>
              <pre className="code-block code-block--compact">{entry.payload}</pre>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
