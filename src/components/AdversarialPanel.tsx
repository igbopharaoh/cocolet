import { useEffect, useMemo, useState } from "react";
import { useCoco } from "../hooks/useCoco";
import type { UseMintsResult } from "../hooks/useMints";
import { toErrorMessage } from "../lib/errors";
import { getMintLabel } from "../lib/format";

type AdversarialPanelProps = {
  mintsState: UseMintsResult;
  onRefreshAll: () => Promise<void>;
};

function normalizeTimestamp(timestamp: number): number {
  return timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1_000;
}

export function AdversarialPanel({ mintsState, onRefreshAll }: AdversarialPanelProps) {
  const { manager } = useCoco();
  const trustedMints = useMemo(() => mintsState.mints.filter((mint) => mint.trusted), [mintsState.mints]);
  const [mintUrl, setMintUrl] = useState("");
  const [customToken, setCustomToken] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [services, setServices] = useState({
    subscriptionsPaused: false,
    mintWatcherEnabled: true,
    mintProcessorEnabled: true,
    proofWatcherEnabled: true,
  });

  useEffect(() => {
    if (!mintUrl && trustedMints[0]) {
      setMintUrl(trustedMints[0].mintUrl);
    }
  }, [mintUrl, trustedMints]);

  async function runAction(action: () => Promise<void>) {
    setBusy(true);
    setStatusMessage(null);

    try {
      await action();
      await onRefreshAll();
    } catch (error) {
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
            <p className="eyebrow">Adversarial lab</p>
            <h2>Failure drills, recovery paths, and safety validation</h2>
          </div>
        </div>

        <label className="field">
          <span className="field__label">Target mint</span>
          <select className="input" value={mintUrl} onChange={(event) => setMintUrl(event.target.value)}>
            <option value="">Select a mint</option>
            {trustedMints.map((mint) => (
              <option key={mint.mintUrl} value={mint.mintUrl}>
                {getMintLabel(mint.mintUrl, mint.name)}
              </option>
            ))}
          </select>
        </label>

        <div className="button-grid">
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={() =>
              runAction(async () => {
                if (!mintUrl) {
                  throw new Error("Select a trusted mint first.");
                }

                const prepared = await manager.ops.send.prepare({ mintUrl, amount: 1 });
                const { token } = await manager.ops.send.execute(prepared.id);
                const encoded = manager.wallet.encodeToken(token);

                await manager.wallet.receive(encoded);

                try {
                  await manager.wallet.receive(encoded);
                  setStatusMessage("Double-spend was not rejected. Investigate this immediately.");
                } catch (error) {
                  setStatusMessage(`Double-spend correctly rejected: ${toErrorMessage(error)}`);
                }
              })
            }
          >
            Double-spend test
          </button>

          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={() =>
              runAction(async () => {
                await manager.wallet.receive("cashuBcorruptpayload");
              })
            }
          >
            Inject corrupt token
          </button>

          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={() =>
              runAction(async () => {
                const prepared = await manager.ops.send.listPrepared();
                const stale = prepared.filter(
                  (operation) => Date.now() - normalizeTimestamp(operation.createdAt) > 60_000,
                );

                for (const operation of stale) {
                  await manager.ops.send.cancel(operation.id);
                }

                setStatusMessage(
                  stale.length === 0
                    ? "No stale prepared sends were found."
                    : `Cancelled ${stale.length} stale prepared send(s).`,
                );
              })
            }
          >
            Recover stale sends
          </button>

          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={() =>
              runAction(async () => {
                await Promise.all([
                  manager.ops.mint.recovery.run(),
                  manager.ops.melt.recovery.run(),
                  manager.ops.send.recovery.run(),
                  manager.ops.receive.recovery.run(),
                ]);
                setStatusMessage("All recovery routines completed.");
              })
            }
          >
            Run all recoveries
          </button>

          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={() =>
              runAction(async () => {
                const operations = await manager.ops.send.listInFlight();
                const pending = operations.filter((operation) => operation.state === "pending");

                for (const operation of pending) {
                  await manager.ops.send.reclaim(operation.id);
                }

                setStatusMessage(
                  pending.length === 0
                    ? "No pending sends were available for reclaim."
                    : `Reclaimed ${pending.length} pending send(s).`,
                );
              })
            }
          >
            Reclaim pending sends
          </button>

          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={() =>
              runAction(async () => {
                if (!mintUrl) {
                  throw new Error("Select a trusted mint first.");
                }

                await manager.wallet.restore(mintUrl);
                setStatusMessage(`Restore completed for ${mintUrl}.`);
              })
            }
          >
            Restore from seed
          </button>

          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={() =>
              runAction(async () => {
                if (services.subscriptionsPaused) {
                  await manager.resumeSubscriptions();
                  setServices((current) => ({ ...current, subscriptionsPaused: false }));
                  setStatusMessage("Realtime subscriptions resumed.");
                } else {
                  await manager.pauseSubscriptions();
                  setServices((current) => ({ ...current, subscriptionsPaused: true }));
                  setStatusMessage("Realtime subscriptions paused.");
                }
              })
            }
          >
            {services.subscriptionsPaused ? "Resume subscriptions" : "Pause subscriptions"}
          </button>

          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={() =>
              runAction(async () => {
                if (services.mintWatcherEnabled) {
                  await manager.disableMintOperationWatcher();
                  setServices((current) => ({ ...current, mintWatcherEnabled: false }));
                  setStatusMessage("Mint watcher disabled.");
                } else {
                  await manager.enableMintOperationWatcher({ watchExistingPendingOnStart: true });
                  setServices((current) => ({ ...current, mintWatcherEnabled: true }));
                  setStatusMessage("Mint watcher re-enabled.");
                }
              })
            }
          >
            {services.mintWatcherEnabled ? "Disable mint watcher" : "Enable mint watcher"}
          </button>

          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={() =>
              runAction(async () => {
                if (services.mintProcessorEnabled) {
                  await manager.disableMintOperationProcessor();
                  setServices((current) => ({ ...current, mintProcessorEnabled: false }));
                  setStatusMessage("Mint processor disabled.");
                } else {
                  await manager.enableMintOperationProcessor({ processIntervalMs: 3_000 });
                  setServices((current) => ({ ...current, mintProcessorEnabled: true }));
                  setStatusMessage("Mint processor re-enabled.");
                }
              })
            }
          >
            {services.mintProcessorEnabled ? "Disable mint processor" : "Enable mint processor"}
          </button>

          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={() =>
              runAction(async () => {
                if (services.proofWatcherEnabled) {
                  await manager.disableProofStateWatcher();
                  setServices((current) => ({ ...current, proofWatcherEnabled: false }));
                  setStatusMessage("Proof watcher disabled.");
                } else {
                  await manager.enableProofStateWatcher({ watchExistingInflightOnStart: true });
                  setServices((current) => ({ ...current, proofWatcherEnabled: true }));
                  setStatusMessage("Proof watcher re-enabled.");
                }
              })
            }
          >
            {services.proofWatcherEnabled ? "Disable proof watcher" : "Enable proof watcher"}
          </button>

          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={() =>
              runAction(async () => {
                const pending = await manager.ops.mint.listPending();

                if (pending.length === 0) {
                  setStatusMessage("No pending mint quotes were found.");
                  return;
                }

                const results = await Promise.all(
                  pending.map(async (operation) => {
                    const check = await manager.ops.mint.checkPayment(operation.id);
                    return `${operation.quoteId}: ${check.observedRemoteState} (${check.category})`;
                  }),
                );

                setStatusMessage(results.join("\n"));
              })
            }
          >
            Check pending mints
          </button>
        </div>

        <label className="field">
          <span className="field__label">Custom token injection</span>
          <textarea
            className="input input--textarea mono"
            rows={4}
            value={customToken}
            onChange={(event) => setCustomToken(event.target.value)}
            placeholder="Paste any token to test how the wallet handles it"
          />
        </label>

        <div className="button-row">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy || !customToken.trim()}
            onClick={() =>
              runAction(async () => {
                await manager.wallet.receive(customToken.trim());
                setStatusMessage("Custom token was accepted by the wallet.");
              })
            }
          >
            Test custom token
          </button>
        </div>

        {statusMessage ? <pre className="status-console">{statusMessage}</pre> : null}
      </div>
    </section>
  );
}
