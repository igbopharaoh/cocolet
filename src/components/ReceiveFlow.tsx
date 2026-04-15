import { useMemo, useState } from "react";
import { getDecodedToken, type ReceiveOpsApi } from "@cashu/coco-core";
import { useCoco } from "../hooks/useCoco";
import { ScannerDialog } from "./ScannerDialog";
import { toErrorMessage } from "../lib/errors";
import { formatSats, getMintLabel, sumAmounts } from "../lib/format";
import { normalizeTokenInput } from "../lib/validation";

type PreparedReceiveOperation = Awaited<ReturnType<ReceiveOpsApi["prepare"]>>;
type DecodedToken = ReturnType<typeof getDecodedToken>;

type ReceiveFlowProps = {
  onRefreshAll: () => Promise<void>;
};

type TokenPreview = {
  token: DecodedToken;
  trusted: boolean;
  totalAmount: number;
};

export function ReceiveFlow({ onRefreshAll }: ReceiveFlowProps) {
  const { manager } = useCoco();
  const [tokenText, setTokenText] = useState("");
  const [preview, setPreview] = useState<TokenPreview | null>(null);
  const [prepared, setPrepared] = useState<PreparedReceiveOperation | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"info" | "success" | "warning" | "error">("info");
  const [busy, setBusy] = useState(false);

  const currentMintUrl = useMemo(() => preview?.token.mint ?? "", [preview]);

  async function handlePreview() {
    setBusy(true);
    setStatusMessage(null);

    try {
      const normalizedToken = normalizeTokenInput(tokenText);
      const decoded = getDecodedToken(normalizedToken);
      const trusted = await manager.mint.isTrustedMint(decoded.mint).catch(() => false);

      setPrepared(null);
      setPreview({
        token: decoded,
        trusted,
        totalAmount: sumAmounts(decoded.proofs),
      });

      setStatusTone(trusted ? "info" : "warning");
      setStatusMessage(
        trusted
          ? "Token decoded successfully. Prepare the receive to inspect fees."
          : "Token decoded, but the mint is not trusted yet. Trust it before claiming proofs.",
      );
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleTrustMint() {
    if (!preview) {
      return;
    }

    setBusy(true);

    try {
      await manager.mint.addMint(preview.token.mint, { trusted: true });
      setPreview({ ...preview, trusted: true });
      setStatusTone("success");
      setStatusMessage(`Mint ${preview.token.mint} was added and trusted.`);
      await onRefreshAll();
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handlePrepareReceive() {
    setBusy(true);

    try {
      if (!preview?.trusted) {
        throw new Error("Trust the mint before preparing the receive.");
      }

      const operation = await manager.ops.receive.prepare({
        token: normalizeTokenInput(tokenText),
      });

      setPrepared(operation);
      setStatusTone("info");
      setStatusMessage("Receive prepared. Review the fee impact and then claim the proofs.");
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleExecuteReceive() {
    if (!prepared) {
      return;
    }

    setBusy(true);

    try {
      await manager.ops.receive.execute(prepared.id);
      setPrepared(null);
      setPreview(null);
      setTokenText("");
      setStatusTone("success");
      setStatusMessage("Token claimed successfully and proofs are now in the wallet.");
      await onRefreshAll();
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
      await manager.ops.receive.cancel(prepared.id);
      setPrepared(null);
      setStatusTone("warning");
      setStatusMessage("Prepared receive cancelled.");
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
        title="Scan a Cashu token"
        description="Point your camera at a Cashu QR code."
        onDetected={(value) => setTokenText(value)}
        onClose={() => setScannerOpen(false)}
      />

      <div className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Receive flow</p>
            <h2>Preview, trust, and claim a Cashu token</h2>
          </div>
        </div>

        <label className="field">
          <div className="label-with-action">
            <span className="field__label">Cashu token</span>
            <button type="button" className="text-action" onClick={() => setScannerOpen(true)}>
              Scan QR
            </button>
          </div>
          <textarea
            className="input input--textarea mono"
            rows={6}
            value={tokenText}
            onChange={(event) => setTokenText(event.target.value)}
            placeholder="Paste or scan a cashuA... or cashuB... token"
          />
        </label>

        <div className="button-row">
          <button type="button" className="btn btn--primary" onClick={handlePreview} disabled={busy}>
            Decode token
          </button>
        </div>

        {preview ? (
          <div className="section-card section-card--nested">
            <div className="section-header">
              <div>
                <p className="eyebrow">Token preview</p>
                <h3>{getMintLabel(preview.token.mint)}</h3>
              </div>
              <span className={`pill ${preview.trusted ? "pill--success" : "pill--warning"}`}>
                {preview.trusted ? "Trusted mint" : "Untrusted mint"}
              </span>
            </div>

            <div className="stat-grid">
              <div className="stat-card">
                <span>Amount</span>
                <strong>{formatSats(preview.totalAmount)}</strong>
              </div>
              <div className="stat-card">
                <span>Proofs</span>
                <strong>{preview.token.proofs.length}</strong>
              </div>
              <div className="stat-card">
                <span>Unit</span>
                <strong>{preview.token.unit ?? "sat"}</strong>
              </div>
            </div>

            {preview.token.memo ? <p className="supporting-text">{preview.token.memo}</p> : null}

            {!preview.trusted ? (
              <div className="button-row">
                <button type="button" className="btn btn--secondary" onClick={handleTrustMint} disabled={busy}>
                  Trust mint and continue
                </button>
              </div>
            ) : null}

            {preview.trusted && !prepared ? (
              <div className="button-row">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={handlePrepareReceive}
                  disabled={busy}
                >
                  Prepare receive
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {prepared ? (
          <div className="section-card section-card--nested">
            <div className="section-header">
              <div>
                <p className="eyebrow">Prepared receive</p>
                <h3>Ready to claim proofs</h3>
              </div>
            </div>

            <div className="key-value-grid">
              <div>
                <span>Mint</span>
                <strong>{getMintLabel(currentMintUrl)}</strong>
              </div>
              <div>
                <span>Amount</span>
                <strong>{formatSats(prepared.amount)}</strong>
              </div>
              <div>
                <span>Receive fee</span>
                <strong>{formatSats(prepared.fee)}</strong>
              </div>
            </div>

            <div className="button-row">
              <button type="button" className="btn btn--primary" onClick={handleExecuteReceive} disabled={busy}>
                Claim proofs
              </button>
              <button type="button" className="btn btn--ghost" onClick={handleCancelPrepared} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {statusMessage ? <p className={`status-banner status-${statusTone}`}>{statusMessage}</p> : null}
      </div>
    </section>
  );
}
