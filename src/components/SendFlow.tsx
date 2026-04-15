import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import type { PreparedSendOperation, SendOperation } from "@cashu/coco-core";
import { useCoco } from "../hooks/useCoco";
import type { UseMintsResult } from "../hooks/useMints";
import { copyTextToClipboard } from "../lib/clipboard";
import { toErrorMessage } from "../lib/errors";
import { formatSats, getMintLabel } from "../lib/format";
import { parseAmount } from "../lib/validation";

type SendFlowProps = {
  mintsState: UseMintsResult;
  onRefreshAll: () => Promise<void>;
};

export function SendFlow({ mintsState, onRefreshAll }: SendFlowProps) {
  const { manager } = useCoco();
  const trustedMints = useMemo(() => mintsState.mints.filter((mint) => mint.trusted), [mintsState.mints]);
  const [mintUrl, setMintUrl] = useState("");
  const [amount, setAmount] = useState("");
  const [prepared, setPrepared] = useState<PreparedSendOperation | null>(null);
  const [latestOperation, setLatestOperation] = useState<SendOperation | null>(null);
  const [encodedToken, setEncodedToken] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"info" | "success" | "warning" | "error">("info");
  const [busy, setBusy] = useState(false);

  const activeOperationId = latestOperation?.id ?? prepared?.id ?? null;

  useEffect(() => {
    if (!activeOperationId) {
      return;
    }

    const unsubscribeFinalized = manager.on("send:finalized", ({ operationId, operation }) => {
      if (operationId !== activeOperationId) {
        return;
      }

      setLatestOperation(operation);
      setPrepared(null);
      setStatusTone("success");
      setStatusMessage("Recipient claimed the token and the send finalized.");
      void onRefreshAll();
    });

    const unsubscribeRolledBack = manager.on("send:rolled-back", ({ operationId, operation }) => {
      if (operationId !== activeOperationId) {
        return;
      }

      setLatestOperation(operation);
      setPrepared(null);
      setStatusTone("warning");
      setStatusMessage("Send operation rolled back and the proofs returned to the wallet.");
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

      const parsedAmount = parseAmount(amount);
      const operation = await manager.ops.send.prepare({
        mintUrl,
        amount: parsedAmount,
      });

      setPrepared(operation);
      setLatestOperation(null);
      setEncodedToken("");
      setQrDataUrl("");
      setStatusTone("info");
      setStatusMessage("Send prepared. Review the reservation details before creating the token.");
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
      const { operation, token } = await manager.ops.send.execute(prepared.id);
      const tokenString = manager.wallet.encodeToken(token);
      const dataUrl = await QRCode.toDataURL(tokenString, { width: 300, margin: 1 });

      setPrepared(null);
      setLatestOperation(operation);
      setEncodedToken(tokenString);
      setQrDataUrl(dataUrl);
      setStatusTone("warning");
      setStatusMessage("Token created. Share it with the recipient or reclaim it later if needed.");
      await onRefreshAll();
    } catch (error) {
      await manager.ops.send.cancel(prepared.id).catch(() => undefined);
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
      await manager.ops.send.cancel(prepared.id);
      setPrepared(null);
      setLatestOperation(null);
      setStatusTone("warning");
      setStatusMessage("Prepared send cancelled and reserved proofs released.");
      await onRefreshAll();
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
      const operation = await manager.ops.send.refresh(activeOperationId);
      setLatestOperation(operation);

      if (operation.state === "finalized") {
        setStatusTone("success");
        setStatusMessage("Send finalized after refresh.");
        await onRefreshAll();
      } else if (operation.state === "rolled_back") {
        setStatusTone("warning");
        setStatusMessage("Send rolled back after refresh.");
        await onRefreshAll();
      } else {
        setStatusTone("info");
        setStatusMessage(`Send operation is still ${operation.state}.`);
      }
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleReclaim() {
    if (!latestOperation) {
      return;
    }

    setBusy(true);

    try {
      await manager.ops.send.reclaim(latestOperation.id);
      setPrepared(null);
      setLatestOperation(null);
      setEncodedToken("");
      setQrDataUrl("");
      setStatusTone("warning");
      setStatusMessage("Pending send reclaimed successfully.");
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
      <div className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Send flow</p>
            <h2>Split proofs and create a Cashu token</h2>
          </div>
        </div>

        {trustedMints.length === 0 ? (
          <div className="empty-state">
            <h3>No trusted mint available</h3>
            <p>Add and trust a mint before creating sendable ecash tokens.</p>
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

              <label className="field">
                <span className="field__label">Amount</span>
                <input
                  className="input"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="10"
                />
              </label>

              <button type="button" className="btn btn--primary" onClick={handlePrepare} disabled={busy}>
                Prepare send
              </button>
            </div>

            {prepared ? (
              <div className="section-card section-card--nested">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Prepared send</p>
                    <h3>Review before tokenizing</h3>
                  </div>
                </div>

                <div className="stat-grid">
                  <div className="stat-card">
                    <span>Amount</span>
                    <strong>{formatSats(prepared.amount)}</strong>
                  </div>
                  <div className="stat-card">
                    <span>Fee</span>
                    <strong>{formatSats(prepared.fee)}</strong>
                  </div>
                  <div className="stat-card">
                    <span>Input amount</span>
                    <strong>{formatSats(prepared.inputAmount)}</strong>
                  </div>
                  <div className="stat-card">
                    <span>Needs swap</span>
                    <strong>{prepared.needsSwap ? "Yes" : "No"}</strong>
                  </div>
                </div>

                <div className="button-row">
                  <button type="button" className="btn btn--primary" onClick={handleExecute} disabled={busy}>
                    Create token
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
                    <p className="eyebrow">Latest send state</p>
                    <h3>{latestOperation.state}</h3>
                  </div>
                </div>

                {encodedToken ? (
                  <div className="detail-grid">
                    <div className="qr-preview">
                      {qrDataUrl ? <img src={qrDataUrl} alt="Cashu token QR code" /> : null}
                    </div>
                    <div className="panel-stack">
                      <label className="field">
                        <span className="field__label">Encoded token</span>
                        <textarea className="input input--textarea mono" rows={6} value={encodedToken} readOnly />
                      </label>

                      <div className="button-row">
                        <button
                          type="button"
                          className="btn btn--secondary"
                          onClick={() => copyTextToClipboard(encodedToken)}
                        >
                          Copy token
                        </button>
                        <button type="button" className="btn btn--ghost" onClick={handleRefreshState} disabled={busy}>
                          Refresh state
                        </button>
                        {latestOperation.state === "pending" ? (
                          <button type="button" className="btn btn--ghost" onClick={handleReclaim} disabled={busy}>
                            Reclaim token
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="button-row">
                    <button type="button" className="btn btn--secondary" onClick={handleRefreshState} disabled={busy}>
                      Refresh state
                    </button>
                  </div>
                )}
              </div>
            ) : null}
          </>
        )}

        {statusMessage ? <p className={`status-banner status-${statusTone}`}>{statusMessage}</p> : null}
      </div>
    </section>
  );
}
