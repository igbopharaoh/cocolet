import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import type { MintOpsApi } from "@cashu/coco-core";
import { useCoco } from "../hooks/useCoco";
import type { UseMintsResult } from "../hooks/useMints";
import { copyTextToClipboard } from "../lib/clipboard";
import { toErrorMessage } from "../lib/errors";
import { formatDateTime, formatRelativeExpiry, getMintLabel } from "../lib/format";
import { parseAmount } from "../lib/validation";

type PendingMintOperation = Awaited<ReturnType<MintOpsApi["prepare"]>>;

type MintFlowProps = {
  mintsState: UseMintsResult;
  onRefreshAll: () => Promise<void>;
};

export function MintFlow({ mintsState, onRefreshAll }: MintFlowProps) {
  const { manager } = useCoco();
  const trustedMints = useMemo(() => mintsState.mints.filter((mint) => mint.trusted), [mintsState.mints]);
  const [mintUrl, setMintUrl] = useState("");
  const [amount, setAmount] = useState("");
  const [pendingMint, setPendingMint] = useState<PendingMintOperation | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"info" | "success" | "warning" | "error">("info");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pendingMint) {
      return;
    }

    let active = true;
    void manager.subscription
      .awaitMintQuotePaid(pendingMint.mintUrl, pendingMint.quoteId)
      .then(() => {
        if (active) {
          setStatusTone("info");
          setStatusMessage("Payment detected. The mint watcher should redeem this quote automatically.");
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [manager, pendingMint]);

  useEffect(() => {
    if (!pendingMint) {
      return;
    }

    const unsubscribeFinalized = manager.on("mint-op:finalized", ({ operationId }) => {
      if (operationId !== pendingMint.id) {
        return;
      }

      setStatusTone("success");
      setStatusMessage("Mint finalized and proofs were saved into the wallet.");
      void onRefreshAll();
    });

    const unsubscribeQuoteState = manager.on("mint-op:quote-state-changed", ({ operationId, state }) => {
      if (operationId !== pendingMint.id) {
        return;
      }

      if (state === "PAID") {
        setStatusTone("info");
        setStatusMessage("Quote marked as paid. Waiting for final redemption.");
      } else if (state === "ISSUED") {
        setStatusTone("success");
        setStatusMessage("Quote was already issued by the mint.");
      }
    });

    return () => {
      unsubscribeFinalized();
      unsubscribeQuoteState();
    };
  }, [manager, onRefreshAll, pendingMint]);

  async function handlePrepare() {
    setBusy(true);
    setStatusMessage(null);

    try {
      if (!mintUrl) {
        throw new Error("Select a trusted mint first.");
      }

      const parsedAmount = parseAmount(amount);
      const operation = await manager.ops.mint.prepare({
        mintUrl,
        amount: parsedAmount,
        method: "bolt11",
        methodData: {},
      });

      const dataUrl = await QRCode.toDataURL(operation.request.toUpperCase(), {
        margin: 1,
        width: 300,
      });

      setPendingMint(operation);
      setQrDataUrl(dataUrl);
      setStatusTone("info");
      setStatusMessage("Invoice created. Pay it externally, then let the watcher redeem or use the manual controls below.");
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckPayment() {
    if (!pendingMint) {
      return;
    }

    setBusy(true);

    try {
      const check = await manager.ops.mint.checkPayment(pendingMint.id);
      setStatusTone(check.category === "waiting" ? "warning" : "info");
      setStatusMessage(
        `Quote state is ${check.observedRemoteState}. coco categorized it as ${check.category}.`,
      );
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleRedeemNow() {
    if (!pendingMint) {
      return;
    }

    setBusy(true);

    try {
      const result = await manager.ops.mint.execute(pendingMint.id);
      if (result.state === "finalized") {
        setStatusTone("success");
        setStatusMessage("Mint redeemed successfully and proofs are now in the wallet.");
        await onRefreshAll();
      } else {
        setStatusTone("error");
        setStatusMessage(result.error || "Mint operation reached a terminal failure state.");
      }
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
            <p className="eyebrow">Mint flow</p>
            <h2>Lightning invoice to ecash proofs</h2>
          </div>
        </div>

        {trustedMints.length === 0 ? (
          <div className="empty-state">
            <h3>No trusted mint available</h3>
            <p>Add and trust a mint before creating a Lightning quote.</p>
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
                  placeholder="21"
                />
              </label>

              <button type="button" className="btn btn--primary" onClick={handlePrepare} disabled={busy}>
                Create invoice
              </button>
            </div>

            {pendingMint ? (
              <div className="detail-grid">
                <div className="qr-preview">
                  {qrDataUrl ? <img src={qrDataUrl} alt="Lightning invoice QR code" /> : null}
                </div>
                <div className="panel-stack">
                  <div className="key-value-grid">
                    <div>
                      <span>Quote ID</span>
                      <strong className="mono">{pendingMint.quoteId}</strong>
                    </div>
                    <div>
                      <span>Amount</span>
                      <strong>{pendingMint.amount} sats</strong>
                    </div>
                    <div>
                      <span>Expires</span>
                      <strong>{formatDateTime(pendingMint.expiry)}</strong>
                    </div>
                    <div>
                      <span>Time left</span>
                      <strong>{formatRelativeExpiry(pendingMint.expiry)}</strong>
                    </div>
                  </div>

                  <label className="field">
                    <span className="field__label">BOLT11 invoice</span>
                    <textarea className="input input--textarea mono" rows={5} value={pendingMint.request} readOnly />
                  </label>

                  <div className="button-row">
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => copyTextToClipboard(pendingMint.request)}
                    >
                      Copy invoice
                    </button>
                    <button type="button" className="btn btn--ghost" onClick={handleCheckPayment} disabled={busy}>
                      Check payment
                    </button>
                    <button type="button" className="btn btn--ghost" onClick={handleRedeemNow} disabled={busy}>
                      Redeem now
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => {
                        setPendingMint(null);
                        setQrDataUrl("");
                        setStatusMessage(null);
                      }}
                    >
                      Clear
                    </button>
                  </div>
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
