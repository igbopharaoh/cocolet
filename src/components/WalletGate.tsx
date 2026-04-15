import { useMemo, useState } from "react";
import { LockKeyhole, RefreshCw, ShieldAlert } from "lucide-react";
import { createWalletMnemonic } from "../coco/seed";
import { createVault, hasStoredVault, unlockVault } from "../coco/vault";
import { copyTextToClipboard } from "../lib/clipboard";
import { toErrorMessage } from "../lib/errors";
import { parseMnemonic } from "../lib/validation";

type WalletGateProps = {
  onUnlock: (mnemonic: string) => void;
};

export function WalletGate({ onUnlock }: WalletGateProps) {
  const existingVault = useMemo(() => hasStoredVault(), []);
  const [generatedMnemonic, setGeneratedMnemonic] = useState(createWalletMnemonic);
  const [unlockPassphrase, setUnlockPassphrase] = useState("");
  const [createPassphrase, setCreatePassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [importMnemonicValue, setImportMnemonicValue] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [acknowledgedBackup, setAcknowledgedBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  async function handleUnlock() {
    setBusy(true);
    setStatusMessage(null);

    try {
      const mnemonic = await unlockVault(unlockPassphrase);
      onUnlock(mnemonic);
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    setBusy(true);
    setStatusMessage(null);

    try {
      if (createPassphrase !== confirmPassphrase) {
        throw new Error("Passphrase confirmation does not match.");
      }

      const mnemonic = isImporting ? parseMnemonic(importMnemonicValue) : generatedMnemonic;

      if (!isImporting && !acknowledgedBackup) {
        throw new Error("Confirm that you have backed up the recovery phrase before continuing.");
      }

      const unlockedMnemonic = await createVault(createPassphrase, mnemonic);
      onUnlock(unlockedMnemonic);
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gate-shell">
      <div className="gate-card gate-card--wide">
        <p className="eyebrow">Cocolet</p>
        <h1>Cashu wallet, observability console, and adversarial lab in one browser app.</h1>
        <p className="supporting-text">
          Your wallet seed is encrypted locally with a passphrase before the coco runtime ever
          starts. Nothing leaves this browser except the mint traffic you explicitly initiate.
        </p>

        <div className="summary-grid">
          <div className="summary-card">
            <ShieldAlert className="summary-card__icon" />
            <strong>Encrypted seed vault</strong>
            <span>No raw mnemonic is stored in plain localStorage.</span>
          </div>
          <div className="summary-card">
            <RefreshCw className="summary-card__icon" />
            <strong>Saga recovery on boot</strong>
            <span>Mint, melt, send, and receive operations are reconciled on startup.</span>
          </div>
          <div className="summary-card">
            <LockKeyhole className="summary-card__icon" />
            <strong>Developer-grade visibility</strong>
            <span>Built for protocol testing, failure drills, and wallet introspection.</span>
          </div>
        </div>

        {existingVault ? (
          <section className="section-card section-card--flat">
            <div className="section-header">
              <div>
                <p className="eyebrow">Unlock wallet</p>
                <h2>Open the encrypted local vault</h2>
              </div>
            </div>

            <label className="field">
              <span className="field__label">Passphrase</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={unlockPassphrase}
                onChange={(event) => setUnlockPassphrase(event.target.value)}
                placeholder="Enter your wallet passphrase"
              />
            </label>

            <div className="button-row">
              <button type="button" className="btn btn--primary" onClick={handleUnlock} disabled={busy}>
                Unlock wallet
              </button>
            </div>
          </section>
        ) : (
          <section className="section-card section-card--flat">
            <div className="section-header">
              <div>
                <p className="eyebrow">Create wallet</p>
                <h2>Bootstrap a new encrypted Cashu vault</h2>
              </div>

              {!isImporting ? (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setGeneratedMnemonic(createWalletMnemonic())}
                >
                  Regenerate phrase
                </button>
              ) : null}
            </div>

            <div className="toggle-row">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={isImporting}
                  onChange={(event) => setIsImporting(event.target.checked)}
                />
                <span>Import an existing recovery phrase instead of generating a new one</span>
              </label>
            </div>

            <label className="field">
              <div className="label-with-action">
                <span className="field__label">{isImporting ? "Recovery phrase" : "Generated recovery phrase"}</span>
                {!isImporting ? (
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => copyTextToClipboard(generatedMnemonic).then(() => setStatusMessage("Recovery phrase copied."))}
                  >
                    Copy
                  </button>
                ) : null}
              </div>
              <textarea
                className="input input--textarea mono"
                rows={4}
                value={isImporting ? importMnemonicValue : generatedMnemonic}
                onChange={(event) => setImportMnemonicValue(event.target.value)}
                readOnly={!isImporting}
              />
            </label>

            <label className="field">
              <span className="field__label">Wallet passphrase</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={createPassphrase}
                onChange={(event) => setCreatePassphrase(event.target.value)}
                placeholder="At least 12 characters"
              />
            </label>

            <label className="field">
              <span className="field__label">Confirm passphrase</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={confirmPassphrase}
                onChange={(event) => setConfirmPassphrase(event.target.value)}
                placeholder="Repeat the same passphrase"
              />
            </label>

            {!isImporting ? (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={acknowledgedBackup}
                  onChange={(event) => setAcknowledgedBackup(event.target.checked)}
                />
                <span>I have written this recovery phrase down somewhere offline.</span>
              </label>
            ) : null}

            <div className="button-row">
              <button type="button" className="btn btn--primary" onClick={handleCreate} disabled={busy}>
                Create wallet
              </button>
            </div>
          </section>
        )}

        {statusMessage ? <p className="status-banner status-error">{statusMessage}</p> : null}
      </div>
    </div>
  );
}
