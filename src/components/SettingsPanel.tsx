import { useEffect, useMemo, useState } from "react";
import { deleteWalletDatabase } from "../coco/manager";
import { changeVaultPassphrase, clearVault, replaceVault } from "../coco/vault";
import { useCoco } from "../hooks/useCoco";
import type { UseMintsResult } from "../hooks/useMints";
import { copyTextToClipboard } from "../lib/clipboard";
import { toErrorMessage } from "../lib/errors";
import { sumAmounts } from "../lib/format";
import { parseMnemonic } from "../lib/validation";

type SettingsPanelProps = {
  currentMnemonic: string;
  mintsState: UseMintsResult;
  onLock: () => void;
  onVaultReplaced: (mnemonic: string) => void;
  onRefreshAll: () => Promise<void>;
};

export function SettingsPanel({
  currentMnemonic,
  mintsState,
  onLock,
  onVaultReplaced,
  onRefreshAll,
}: SettingsPanelProps) {
  const { manager, repo } = useCoco();
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [bundle, setBundle] = useState("");
  const [restoreMintUrl, setRestoreMintUrl] = useState("");
  const [currentPassphrase, setCurrentPassphrase] = useState("");
  const [nextPassphrase, setNextPassphrase] = useState("");
  const [confirmNextPassphrase, setConfirmNextPassphrase] = useState("");
  const [replacementMnemonic, setReplacementMnemonic] = useState("");
  const [replacementPassphrase, setReplacementPassphrase] = useState("");
  const [confirmReplacementPassphrase, setConfirmReplacementPassphrase] = useState("");
  const [wipeConfirmation, setWipeConfirmation] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"info" | "success" | "warning" | "error">("info");
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const trustedMints = useMemo(() => mintsState.mints.filter((mint) => mint.trusted), [mintsState.mints]);

  useEffect(() => {
    if (!restoreMintUrl && trustedMints[0]) {
      setRestoreMintUrl(trustedMints[0].mintUrl);
    }
  }, [restoreMintUrl, trustedMints]);

  async function exportBackupBundle() {
    setBusyAction("export");
    setStatusMessage(null);

    try {
      const exportedTokens = await Promise.all(
        mintsState.mints.map(async (mint) => {
          const proofs = await repo.proofRepository.getAvailableProofs(mint.mintUrl);
          if (proofs.length === 0) {
            return null;
          }

          return {
            mintUrl: mint.mintUrl,
            amount: sumAmounts(proofs),
            token: manager.wallet.encodeToken({
              mint: mint.mintUrl,
              proofs,
            }),
          };
        }),
      );

      const filtered = exportedTokens.filter(Boolean);

      if (filtered.length === 0) {
        throw new Error("There are no spendable proofs available to export right now.");
      }

      const value = JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          warning: "Only spendable proofs are exported. Pending or reserved operations are excluded.",
          tokens: filtered,
        },
        null,
        2,
      );

      setBundle(value);
      setStatusTone("success");
      setStatusMessage("Spendable proof bundle exported locally.");
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(toErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function restoreSelectedMint() {
    setBusyAction("restore");
    setStatusMessage(null);

    try {
      if (!restoreMintUrl) {
        throw new Error("Select a mint to restore from.");
      }

      await manager.wallet.restore(restoreMintUrl);
      await onRefreshAll();
      setStatusTone("success");
      setStatusMessage(`Wallet restore finished for ${restoreMintUrl}.`);
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(toErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function updatePassphrase() {
    setBusyAction("passphrase");
    setStatusMessage(null);

    try {
      if (nextPassphrase !== confirmNextPassphrase) {
        throw new Error("New passphrase confirmation does not match.");
      }

      await changeVaultPassphrase(currentPassphrase, nextPassphrase);
      setCurrentPassphrase("");
      setNextPassphrase("");
      setConfirmNextPassphrase("");
      setStatusTone("success");
      setStatusMessage("Wallet passphrase updated.");
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(toErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function replaceWalletFromMnemonic() {
    setBusyAction("replace");
    setStatusMessage(null);

    try {
      if (replacementPassphrase !== confirmReplacementPassphrase) {
        throw new Error("Replacement passphrase confirmation does not match.");
      }

      const mnemonic = parseMnemonic(replacementMnemonic);

      if (
        !window.confirm(
          "Replace the current wallet seed and wipe the local IndexedDB state before restoring the new wallet?",
        )
      ) {
        return;
      }

      await deleteWalletDatabase();
      const nextMnemonic = await replaceVault(replacementPassphrase, mnemonic);
      onVaultReplaced(nextMnemonic);
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(toErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function wipeWallet() {
    setBusyAction("wipe");
    setStatusMessage(null);

    try {
      if (wipeConfirmation !== "WIPE COCOLET") {
        throw new Error('Type "WIPE COCOLET" to confirm the destructive erase.');
      }

      await deleteWalletDatabase();
      clearVault();
      onLock();
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(toErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section className="panel-stack">
      <div className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Settings</p>
            <h2>Backups, restores, passphrase management, and destructive controls</h2>
          </div>
        </div>

        <div className="section-card section-card--nested">
          <div className="section-header">
            <div>
              <p className="eyebrow">Recovery phrase</p>
              <h3>Reveal or copy the encrypted wallet seed</h3>
            </div>
          </div>

          <div className="button-row">
            <button type="button" className="btn btn--secondary" onClick={() => setShowMnemonic((value) => !value)}>
              {showMnemonic ? "Hide phrase" : "Reveal phrase"}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => copyTextToClipboard(currentMnemonic)}
            >
              Copy phrase
            </button>
          </div>

          {showMnemonic ? (
            <textarea className="input input--textarea mono" rows={4} value={currentMnemonic} readOnly />
          ) : null}
        </div>

        <div className="section-card section-card--nested">
          <div className="section-header">
            <div>
              <p className="eyebrow">Proof backup</p>
              <h3>Export spendable ecash by mint</h3>
            </div>
          </div>

          <p className="supporting-text">
            This exports only spendable proofs. Anything reserved by an in-flight operation is
            intentionally excluded to avoid incomplete backups.
          </p>

          <div className="button-row">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={exportBackupBundle}
              disabled={busyAction !== null}
            >
              Export proof bundle
            </button>
            {bundle ? (
              <button type="button" className="btn btn--ghost" onClick={() => copyTextToClipboard(bundle)}>
                Copy bundle
              </button>
            ) : null}
          </div>

          {bundle ? <textarea className="input input--textarea mono" rows={8} value={bundle} readOnly /> : null}
        </div>

        <div className="section-card section-card--nested">
          <div className="section-header">
            <div>
              <p className="eyebrow">Restore proofs</p>
              <h3>Run seed-based restore against a mint</h3>
            </div>
          </div>

          <div className="form-grid">
            <label className="field field--grow">
              <span className="field__label">Trusted mint</span>
              <select className="input" value={restoreMintUrl} onChange={(event) => setRestoreMintUrl(event.target.value)}>
                <option value="">Select a mint</option>
                {trustedMints.map((mint) => (
                  <option key={mint.mintUrl} value={mint.mintUrl}>
                    {mint.name || mint.mintUrl}
                  </option>
                ))}
              </select>
            </label>

            <button type="button" className="btn btn--secondary" onClick={restoreSelectedMint} disabled={busyAction !== null}>
              Restore now
            </button>
          </div>
        </div>

        <div className="section-card section-card--nested">
          <div className="section-header">
            <div>
              <p className="eyebrow">Passphrase rotation</p>
              <h3>Re-encrypt the local vault with a new passphrase</h3>
            </div>
          </div>

          <div className="form-grid">
            <label className="field">
              <span className="field__label">Current passphrase</span>
              <input
                className="input"
                type="password"
                value={currentPassphrase}
                onChange={(event) => setCurrentPassphrase(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">New passphrase</span>
              <input
                className="input"
                type="password"
                value={nextPassphrase}
                onChange={(event) => setNextPassphrase(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Confirm new passphrase</span>
              <input
                className="input"
                type="password"
                value={confirmNextPassphrase}
                onChange={(event) => setConfirmNextPassphrase(event.target.value)}
              />
            </label>
          </div>

          <div className="button-row">
            <button type="button" className="btn btn--secondary" onClick={updatePassphrase} disabled={busyAction !== null}>
              Update passphrase
            </button>
          </div>
        </div>

        <div className="section-card section-card--nested">
          <div className="section-header">
            <div>
              <p className="eyebrow">Replace wallet</p>
              <h3>Import a different recovery phrase and start from a clean local database</h3>
            </div>
          </div>

          <label className="field">
            <span className="field__label">Replacement mnemonic</span>
            <textarea
              className="input input--textarea mono"
              rows={4}
              value={replacementMnemonic}
              onChange={(event) => setReplacementMnemonic(event.target.value)}
            />
          </label>

          <div className="form-grid">
            <label className="field">
              <span className="field__label">New vault passphrase</span>
              <input
                className="input"
                type="password"
                value={replacementPassphrase}
                onChange={(event) => setReplacementPassphrase(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Confirm passphrase</span>
              <input
                className="input"
                type="password"
                value={confirmReplacementPassphrase}
                onChange={(event) => setConfirmReplacementPassphrase(event.target.value)}
              />
            </label>
          </div>

          <div className="button-row">
            <button
              type="button"
              className="btn btn--warning"
              onClick={replaceWalletFromMnemonic}
              disabled={busyAction !== null}
            >
              Replace wallet seed
            </button>
          </div>
        </div>

        <div className="section-card section-card--nested section-card--danger">
          <div className="section-header">
            <div>
              <p className="eyebrow">Danger zone</p>
              <h3>Lock or erase the wallet</h3>
            </div>
          </div>

          <div className="button-row">
            <button type="button" className="btn btn--ghost" onClick={onLock}>
              Lock session
            </button>
          </div>

          <label className="field">
            <span className="field__label">Type WIPE COCOLET to erase the wallet completely</span>
            <input
              className="input mono"
              value={wipeConfirmation}
              onChange={(event) => setWipeConfirmation(event.target.value)}
            />
          </label>

          <div className="button-row">
            <button type="button" className="btn btn--danger" onClick={wipeWallet} disabled={busyAction !== null}>
              Erase wallet and vault
            </button>
          </div>
        </div>

        {statusMessage ? <p className={`status-banner status-${statusTone}`}>{statusMessage}</p> : null}
        <p className="supporting-text">
          Trusted mints configured: {trustedMints.length}. Use restore to sweep a specific mint from
          the current seed.
        </p>
      </div>
    </section>
  );
}
