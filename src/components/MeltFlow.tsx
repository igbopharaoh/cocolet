import { useEffect, useMemo, useState } from "react";
import type { MeltOperation, MeltOpsApi } from "@cashu/coco-core";
import { useCoco } from "../hooks/useCoco";
import type { UseMintsResult } from "../hooks/useMints";
import { ScannerDialog } from "./ScannerDialog";
import { formatSats, getMintLabel } from "../lib/format";
import { toErrorMessage } from "../lib/errors";
import { normalizeLightningRequest } from "../lib/validation";

type PreparedMeltOperation = Awaited<ReturnType<MeltOpsApi["prepare"]>>;

type MeltFlowProps = {
  mintsState: UseMintsResult;
  onRefreshAll: () => Promise<void>;
};

export function MeltFlow({ mintsState, onRefreshAll }: MeltFlowProps) {
  const { manager } = useCoco();
  const trustedMints = useMemo(() => mintsState.mints.filter((mint) => mint.trusted), [mintsState.mints]);
  const [mintUrl, setMintUrl] = useState("");
  const [invoice, setInvoice] = useState("");
  const [prepared, setPrepared] = useState<PreparedMeltOperation | null>(null);
  const [latestOperation, setLatestOperation] = useState<MeltOperation | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"info" | "success" | "warning" | "error">("info");
  const [busy, setBusy] = useState(false);

  const activeOperationId = prepared?.id ?? latestOperation?.id ?? null;
  const latestPreparedData =
    latestOperation && "inputAmount" in latestOperation && "amount" in latestOperation
      ? latestOperation
      : null;

  useEffect(() => {
    if (!activeOperationId) {
      return;
    }

    const unsubscribeFinalized = manager.on("melt-op:finalized", ({ operationId, operation }) => {
      if (operationId !== activeOperationId) {
        return;
      }

      setLatestOperation(operation);
      setPrepared(null);
      setStatusTone("success");
      setStatusMessage("Lightning payment was settled successfully.");
      void onRefreshAll();
    });

    const unsubscribeRolledBack = manager.on("melt-op:rolled-back", ({ operationId, operation }) => {
      if (operationId !== activeOperationId) {
        return;
      }

      setLatestOperation(operation);
      setPrepared(null);
      setStatusTone("warning");
      setStatusMessage("The melt operation rolled back and reserved proofs were reclaimed.");
      void onRefreshAll();
    });

    return () => {
      unsubscribeFinalized();
      unsubscribeRolledBack();
    };
  }, [activeOperationId, manager, onRefreshAll]);

  async function handlePrepare() {
    setBusy(true);
    setStatusMessage(null);

    try {
      if (!mintUrl) {
        throw new Error("Select a trusted mint first.");
      }

      const normalizedInvoice = normalizeLightningRequest(invoice);
      const operation = await manager.ops.melt.prepare({
        mintUrl,
        method: "bolt11",
        methodData: { invoice: normalizedInvoice },
      });

      setPrepared(operation);
      setLatestOperation(null);
      setStatusTone("info");
      setStatusMessage("Fee quote prepared. Review the reservation details before paying.");
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleExecute() {
    if (!prepared) {
      return;
    }

    setBusy(true);

    try {
      const operation = await manager.ops.melt.execute(prepared.id);
      setLatestOperation(operation);

      if (operation.state === "finalized") {
        setPrepared(null);
        setStatusTone("success");
        setStatusMessage("Lightning payment completed successfully.");
        await onRefreshAll();
      } else {
        setStatusTone("warning");
        setStatusMessage("Payment is pending. Use refresh or wait for the watcher to settle it.");
      }
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleRefreshState() {
    if (!activeOperationId) {
      return;
    }

    setBusy(true);

    try {
      const operation = await manager.ops.melt.refresh(activeOperationId);
      setLatestOperation(operation);

      if (operation.state === "finalized") {
        setPrepared(null);
        setStatusTone("success");
        setStatusMessage("Melt operation finalized after refresh.");
        await onRefreshAll();
      } else if (operation.state === "failed" || operation.state === "rolled_back") {
        setPrepared(null);
        setStatusTone("warning");
        setStatusMessage(operation.error || `Operation settled as ${operation.state}.`);
        await onRefreshAll();
      } else {
        setStatusTone("info");
        setStatusMessage(`Operation is still ${operation.state}.`);
      }
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelPrepared() {
    if (!prepared) {
      return;
    }

    setBusy(true);

    try {
      await manager.ops.melt.cancel(prepared.id);
      setPrepared(null);
      setLatestOperation(null);
      setStatusTone("warning");
      setStatusMessage("Prepared melt cancelled and proofs were released.");
      await onRefreshAll();
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleReclaimPending() {
    if (!activeOperationId) {
      return;
    }

    setBusy(true);

    try {
      await manager.ops.melt.reclaim(activeOperationId);
      setPrepared(null);
      setLatestOperation(null);
      setStatusTone("warning");
      setStatusMessage("Pending melt reclaimed successfully.");
      await onRefreshAll();
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel-stack">
      <ScannerDialog
        open={scannerOpen}
        title="Scan a Lightning invoice"
        description="Point your camera at a BOLT11 QR code."
        onDetected={(value) => setInvoice(value)}
        onClose={() => setScannerOpen(false)}
      />

      <div className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Melt flow</p>
            <h2>Ecash proofs to Lightning payment</h2>
          </div>
        </div>

        {trustedMints.length === 0 ? (
          <div className="empty-state">
            <h3>No trusted mint available</h3>
            <p>Add and trust a mint before spending ecash to Lightning.</p>
          </div>
        ) : (
          <>
            <div className="form-grid">
              <label className="field">
                <span className="field__label">Trusted mint</span>
                <select className="input" value={mintUrl} onChange={(event) => setMintUrl(event.target.value)}>
                  <option value="">Select a mint</option>
                  {trustedMints.map((mint) => (
                    <option key={mint.mintUrl} value={mint.mintUrl}>
                      {getMintLabel(mint.mintUrl, mint.name)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field field--grow">
                <div className="label-with-action">
                  <span className="field__label">BOLT11 invoice</span>
                  <button type="button" className="text-action" onClick={() => setScannerOpen(true)}>
                    Scan QR
                  </button>
                </div>
                <textarea
                  className="input input--textarea mono"
                  rows={4}
                  value={invoice}
                  onChange={(event) => setInvoice(event.target.value)}
                  placeholder="Paste or scan a Lightning invoice"
                />
              </label>

              <button type="button" className="btn btn--primary" onClick={handlePrepare} disabled={busy}>
                Get fee quote
              </button>
            </div>

            {prepared ? (
              <div className="section-card section-card--nested">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Prepared operation</p>
                    <h3>Review the spend reservation</h3>
                  </div>
                </div>

                <div className="stat-grid">
                  <div className="stat-card">
                    <span>Amount</span>
                    <strong>{formatSats(prepared.amount)}</strong>
                  </div>
                  <div className="stat-card">
                    <span>Fee reserve</span>
                    <strong>{formatSats(prepared.fee_reserve)}</strong>
                  </div>
                  <div className="stat-card">
                    <span>Swap fee</span>
                    <strong>{formatSats(prepared.swap_fee)}</strong>
                  </div>
                  <div className="stat-card">
                    <span>Input amount</span>
                    <strong>{formatSats(prepared.inputAmount)}</strong>
                  </div>
                </div>

                <div className="key-value-grid">
                  <div>
                    <span>Needs swap</span>
                    <strong>{prepared.needsSwap ? "Yes" : "No"}</strong>
                  </div>
                  <div>
                    <span>Quote ID</span>
                    <strong className="mono">{prepared.quoteId}</strong>
                  </div>
                </div>

                <div className="button-row">
                  <button type="button" className="btn btn--primary" onClick={handleExecute} disabled={busy}>
                    Confirm and pay
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={handleCancelPrepared} disabled={busy}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

            {latestOperation ? (
              <div className="section-card section-card--nested">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Latest melt state</p>
                    <h3>{latestOperation.state}</h3>
                  </div>
                </div>

                <div className="key-value-grid">
                  <div>
                    <span>Operation ID</span>
                    <strong className="mono">{latestOperation.id}</strong>
                  </div>
                  {latestPreparedData ? (
                    <>
                      <div>
                        <span>Input amount</span>
                        <strong>{formatSats(latestPreparedData.inputAmount)}</strong>
                      </div>
                      <div>
                        <span>Requested amount</span>
                        <strong>{formatSats(latestPreparedData.amount)}</strong>
                      </div>
                    </>
                  ) : null}
                  {latestOperation.state === "finalized" ? (
                    <>
                      <div>
                        <span>Change returned</span>
                        <strong>{formatSats(latestOperation.changeAmount ?? 0)}</strong>
                      </div>
                      <div>
                        <span>Effective fee</span>
                        <strong>{formatSats(latestOperation.effectiveFee ?? 0)}</strong>
                      </div>
                    </>
                  ) : null}
                </div>

                <div className="button-row">
                  <button type="button" className="btn btn--secondary" onClick={handleRefreshState} disabled={busy}>
                    Refresh state
                  </button>
                  {latestOperation.state === "pending" ? (
                    <button type="button" className="btn btn--ghost" onClick={handleReclaimPending} disabled={busy}>
                      Reclaim pending melt
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        )}

        {statusMessage ? <p className={`status-banner status-${statusTone}`}>{statusMessage}</p> : null}
      </div>
    </section>
  );
}
