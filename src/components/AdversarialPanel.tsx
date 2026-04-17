import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  clearFaults,
  describeFaultEndpoint,
  describeFaultKind,
  getFaultsSnapshot,
  queueFault,
  subscribeToFaults,
} from "../coco/faults";
import { useCoco } from "../hooks/useCoco";
import type { UseMintsResult } from "../hooks/useMints";
import { toErrorMessage } from "../lib/errors";
import { getMintLabel } from "../lib/format";

type AdversarialPanelProps = {
  mintsState: UseMintsResult;
  onRefreshAll: () => Promise<void>;
};

type PrivateWalletService = {
  clearCache: (mintUrl: string) => void;
  refreshWallet: (mintUrl: string) => Promise<unknown>;
};

function normalizeTimestamp(timestamp: number): number {
  return timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1_000;
}

function hasWalletCacheService(value: unknown): value is { walletService: PrivateWalletService } {
  if (typeof value !== "object" || value === null || !("walletService" in value)) {
    return false;
  }

  const walletService = Reflect.get(value, "walletService");
  return (
    typeof walletService === "object" &&
    walletService !== null &&
    "clearCache" in walletService &&
    typeof Reflect.get(walletService, "clearCache") === "function" &&
    "refreshWallet" in walletService &&
    typeof Reflect.get(walletService, "refreshWallet") === "function"
  );
}

export function AdversarialPanel({ mintsState, onRefreshAll }: AdversarialPanelProps) {
  const { manager } = useCoco();
  const trustedMints = useMemo(() => mintsState.mints.filter((mint) => mint.trusted), [mintsState.mints]);
  const faults = useSyncExternalStore(subscribeToFaults, getFaultsSnapshot, getFaultsSnapshot);
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

  const visibleFaults = useMemo(
    () => faults.filter((fault) => (mintUrl ? fault.mintUrl === mintUrl : true)),
    [faults, mintUrl],
  );

  useEffect(() => {
    if (!mintUrl && trustedMints[0]) {
      setMintUrl(trustedMints[0].mintUrl);
    }
  }, [mintUrl, trustedMints]);

  function requireMintUrl(): string {
    if (!mintUrl) {
      throw new Error("Select a trusted mint first.");
    }

    return mintUrl;
  }

  function getWalletCacheService(): PrivateWalletService {
    const privateManager = manager as unknown;

    if (!hasWalletCacheService(privateManager)) {
      throw new Error("Wallet cache controls are unavailable in this coco build.");
    }

    return privateManager.walletService;
  }

  async function refreshWalletCache(targetMintUrl: string): Promise<void> {
    const walletCacheService = getWalletCacheService();
    walletCacheService.clearCache(targetMintUrl);
    await walletCacheService.refreshWallet(targetMintUrl);
  }

  async function cleanupSendDrill(operationId: string, targetMintUrl: string): Promise<string> {
    await manager.ops.send.recovery.run().catch(() => undefined);

    const current = await manager.ops.send.get(operationId).catch(() => null);

    if (current?.state === "prepared") {
      await manager.ops.send.cancel(operationId).catch(() => undefined);
    }

    if (current?.state === "pending") {
      await manager.ops.send.reclaim(operationId).catch(() => undefined);
    }

    getWalletCacheService().clearCache(targetMintUrl);
    const refreshed = await manager.ops.send.get(operationId).catch(() => null);
    return refreshed?.state ?? current?.state ?? "missing";
  }

  async function prepareSwapDrill(targetMintUrl: string) {
    const spendableBalance = await manager.wallet.getSpendableBalance(targetMintUrl);

    if (spendableBalance < 1) {
      throw new Error("These swap drills need at least 1 sat of spendable balance on the selected mint.");
    }

    const { publicKeyHex } = await manager.keyring.generateKeyPair();
    const prepared = await manager.ops.send.prepare({
      mintUrl: targetMintUrl,
      amount: 1,
      target: {
        type: "p2pk",
        pubkey: publicKeyHex,
      },
    });

    if (!prepared.needsSwap) {
      throw new Error("Expected the P2PK drill send to require a swap, but coco prepared an exact send instead.");
    }

    return prepared;
  }

  async function runSwapFaultDrill(input: {
    title: string;
    kind: Parameters<typeof queueFault>[0]["kind"];
    description: string;
    beforeExecute?: (targetMintUrl: string) => Promise<void>;
  }) {
    const targetMintUrl = requireMintUrl();
    clearFaults(targetMintUrl);

    const prepared = await prepareSwapDrill(targetMintUrl);

    queueFault({
      kind: input.kind,
      mintUrl: targetMintUrl,
      endpoint: "swap",
      description: input.description,
    });

    try {
      await input.beforeExecute?.(targetMintUrl);
      await manager.ops.send.execute(prepared.id);
      const finalState = await cleanupSendDrill(prepared.id, targetMintUrl);
      setStatusMessage(
        `${input.title} did not block the swap request. Cleanup reclaimed the test send and left the operation in '${finalState}'.`,
      );
    } catch (error) {
      const finalState = await cleanupSendDrill(prepared.id, targetMintUrl);
      setStatusMessage(
        `${input.title} correctly interrupted the swap drill.\n${toErrorMessage(error)}\nOperation state after cleanup: ${finalState}`,
      );
    } finally {
      clearFaults(targetMintUrl);
    }
  }

  async function runKeysetRotationDrill() {
    const targetMintUrl = requireMintUrl();
    clearFaults(targetMintUrl);

    const prepared = await prepareSwapDrill(targetMintUrl);

    queueFault({
      kind: "keyset_rotation_mid_operation",
      mintUrl: targetMintUrl,
      endpoint: "keysets",
      description: "Rotate the advertised active keyset during the wallet refresh that happens before send execution.",
    });

    try {
      getWalletCacheService().clearCache(targetMintUrl);
      await manager.ops.send.execute(prepared.id);
      const finalState = await cleanupSendDrill(prepared.id, targetMintUrl);
      setStatusMessage(
        `Keyset rotation did not interrupt execution. Cleanup reclaimed the test send and left the operation in '${finalState}'.`,
      );
    } catch (error) {
      const finalState = await cleanupSendDrill(prepared.id, targetMintUrl);
      setStatusMessage(
        `Keyset rotation correctly broke the in-flight send during wallet refresh.\n${toErrorMessage(error)}\nOperation state after cleanup: ${finalState}`,
      );
    } finally {
      clearFaults(targetMintUrl);
      getWalletCacheService().clearCache(targetMintUrl);
    }
  }

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
          <div className="section-copy">
            <p className="eyebrow">Adversarial lab</p>
            <h2>Failure drills, recovery paths, and safety validation</h2>
            <p className="supporting-text">
              The new swap drills run against a 1 sat P2PK send so they hit the real mint request path. If a drill
              unexpectedly succeeds, Cocolet immediately tries to reclaim the test send and clear the wallet cache.
            </p>
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
          <span className="field__hint">Swap drills need at least 1 sat of spendable balance on this mint.</span>
        </label>

        <div className="section-card section-card--nested">
          <div className="section-header">
            <div className="section-copy">
              <h3>Armed faults</h3>
              <p className="supporting-text">
                Faults are one-shot. They clear themselves after the next matching request or when you reset them here.
              </p>
            </div>

            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy || visibleFaults.length === 0}
              onClick={() => {
                clearFaults(mintUrl || undefined);
                setStatusMessage("Cleared all armed faults for the current scope.");
              }}
            >
              Clear armed faults
            </button>
          </div>

          {visibleFaults.length === 0 ? (
            <p className="supporting-text">No faults are currently armed.</p>
          ) : (
            <div className="fault-list">
              {visibleFaults.map((fault) => (
                <article key={fault.id} className="fault-card">
                  <strong>{describeFaultKind(fault.kind)}</strong>
                  <span>{describeFaultEndpoint(fault.endpoint)}</span>
                  <p>{fault.description}</p>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="button-grid">
          <button
            type="button"
            className="btn btn--warning"
            disabled={busy}
            onClick={() =>
              runAction(async () => {
                await runSwapFaultDrill({
                  title: "Network failure",
                  kind: "network_failure",
                  description: "Drop the next /v1/swap call to simulate a mint or transport outage mid-send.",
                });
              })
            }
          >
            Simulate swap network failure
          </button>

          <button
            type="button"
            className="btn btn--warning"
            disabled={busy}
            onClick={() =>
              runAction(async () => {
                await runSwapFaultDrill({
                  title: "Partial mint response",
                  kind: "partial_mint_response",
                  description: "Return an incomplete /v1/swap payload so the wallet sees a truncated mint response.",
                });
              })
            }
          >
            Simulate partial swap response
          </button>

          <button
            type="button"
            className="btn btn--warning"
            disabled={busy}
            onClick={() =>
              runAction(async () => {
                await runSwapFaultDrill({
                  title: "Invalid signatures",
                  kind: "invalid_signatures",
                  description: "Corrupt the first swap signature so proof construction fails during unblinding.",
                });
              })
            }
          >
            Simulate invalid swap signatures
          </button>

          <button
            type="button"
            className="btn btn--warning"
            disabled={busy}
            onClick={() =>
              runAction(async () => {
                await runKeysetRotationDrill();
              })
            }
          >
            Simulate keyset rotation
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
                const targetMintUrl = requireMintUrl();
                await manager.wallet.restore(targetMintUrl);
                setStatusMessage(`Restore completed for ${targetMintUrl}.`);
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

          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={() =>
              runAction(async () => {
                const targetMintUrl = requireMintUrl();
                await refreshWalletCache(targetMintUrl);
                setStatusMessage(`Forced a fresh wallet reload for ${targetMintUrl}.`);
              })
            }
          >
            Refresh wallet cache
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
