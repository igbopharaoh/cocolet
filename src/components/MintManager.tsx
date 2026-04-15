import { useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { toErrorMessage } from "../lib/errors";
import { formatDateTime, formatSats, getMintLabel, truncateMiddle } from "../lib/format";
import { parseMintUrl } from "../lib/validation";
import { useCoco } from "../hooks/useCoco";
import { useDiscoverMints, type MintRecommendation } from "../hooks/useDiscoverMints";
import type { UseBalancesResult } from "../hooks/useBalances";
import type { UseMintsResult } from "../hooks/useMints";
import type { UseOperationsResult } from "../hooks/useOperations";

type MintManagerProps = {
  mintsState: UseMintsResult;
  balancesState: UseBalancesResult;
  operationsState: UseOperationsResult;
  onRefreshAll: () => Promise<void>;
};

type MintServiceBridge = {
  mintService?: {
    deleteMint: (mintUrl: string) => Promise<void>;
  };
};

function formatEntryLabel(path: string): string {
  return path
    .replace(/\[(\d+)\]/g, " $1")
    .replace(/[._]/g, " ")
    .trim();
}

export function MintManager({ mintsState, balancesState, operationsState, onRefreshAll }: MintManagerProps) {
  const { manager } = useCoco();
  const discoverState = useDiscoverMints(mintsState.mints);
  const [url, setUrl] = useState("");
  const [directoryView, setDirectoryView] = useState<"featured" | "all">("featured");
  const [directorySearch, setDirectorySearch] = useState("");
  const [selectedRecommendation, setSelectedRecommendation] = useState<MintRecommendation | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const activeMintOperationUrls = useMemo(
    () =>
      new Set(
        [
          ...operationsState.send.prepared,
          ...operationsState.send.inFlight,
          ...operationsState.melt.prepared,
          ...operationsState.melt.inFlight,
          ...operationsState.receive.prepared,
          ...operationsState.receive.inFlight,
          ...operationsState.mint.pending,
          ...operationsState.mint.inFlight,
        ].map((operation) => operation.mintUrl),
      ),
    [operationsState],
  );

  const featuredRecommendations = useMemo(() => discoverState.recommendations.slice(0, 8), [discoverState.recommendations]);

  const filteredRecommendations = useMemo(() => {
    const query = directorySearch.trim().toLowerCase();

    if (!query) {
      return discoverState.recommendations;
    }

    return discoverState.recommendations.filter((recommendation) => {
      const haystacks = [
        recommendation.name,
        recommendation.normalizedUrl,
        recommendation.parsedInfo.pubkey ?? "",
        ...recommendation.parsedInfo.entries.map((entry) => `${entry.path} ${entry.value}`),
      ];

      return haystacks.some((value) => value.toLowerCase().includes(query));
    });
  }, [directorySearch, discoverState.recommendations]);

  async function handleAddMint() {
    setBusyKey("add");
    setStatusMessage(null);

    try {
      const mintUrl = parseMintUrl(url);
      await manager.mint.addMint(mintUrl, { trusted: true });
      setUrl("");
      await onRefreshAll();
      setStatusMessage(`Mint ${mintUrl} was added and trusted.`);
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleConnectRecommendedMint(mintUrl: string) {
    setBusyKey(`recommend:${mintUrl}`);
    setStatusMessage(null);

    try {
      await manager.mint.addMint(mintUrl, { trusted: true });
      await Promise.all([onRefreshAll(), discoverState.refresh()]);
      setStatusMessage(`Mint ${mintUrl} was added and trusted.`);
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRefreshMint(mintUrl: string, trusted: boolean) {
    setBusyKey(`refresh:${mintUrl}`);
    setStatusMessage(null);

    try {
      await manager.mint.addMint(mintUrl, { trusted });
      await onRefreshAll();
      setStatusMessage(`Mint metadata refreshed for ${mintUrl}.`);
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleToggleTrust(mintUrl: string, trusted: boolean) {
    setBusyKey(`trust:${mintUrl}`);
    setStatusMessage(null);

    try {
      if (trusted) {
        await manager.mint.untrustMint(mintUrl);
      } else {
        await manager.mint.trustMint(mintUrl);
      }

      await onRefreshAll();
      setStatusMessage(trusted ? `Mint ${mintUrl} is now untrusted.` : `Mint ${mintUrl} is now trusted.`);
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRemoveMint(mintUrl: string) {
    const balance = balancesState.byMint[mintUrl];
    const hasFunds = (balance?.controlled ?? 0) > 0;
    const hasActiveOperations = activeMintOperationUrls.has(mintUrl);

    if (hasFunds || hasActiveOperations) {
      setStatusMessage("Only empty mints without active operations can be removed.");
      return;
    }

    if (!window.confirm(`Remove ${mintUrl} from the local wallet database?`)) {
      return;
    }

    setBusyKey(`remove:${mintUrl}`);
    setStatusMessage(null);

    try {
      const bridge = manager as unknown as MintServiceBridge;
      if (!bridge.mintService?.deleteMint) {
        throw new Error("Mint deletion is not available in this coco build.");
      }

      await bridge.mintService.deleteMint(mintUrl);
      await onRefreshAll();
      setStatusMessage(`Mint ${mintUrl} was removed from local storage.`);
    } catch (error) {
      setStatusMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  }

  function openRecommendationDetails(recommendation: MintRecommendation, event?: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) {
    event?.preventDefault();
    setSelectedRecommendation(recommendation);
  }

  function handleRecommendationCardKeyDown(recommendation: MintRecommendation, event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") {
      openRecommendationDetails(recommendation, event);
    }
  }

  function closeRecommendationModal() {
    setSelectedRecommendation(null);
  }

  function handleCardConnect(recommendation: MintRecommendation, event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    void handleConnectRecommendedMint(recommendation.normalizedUrl);
  }

  function renderRecommendationGrid(recommendations: MintRecommendation[]) {
    return (
      <div className='recommendation-grid'>
        {recommendations.map((recommendation) => (
          <article
            key={recommendation.normalizedUrl}
            className='section-card section-card--nested recommendation-card recommendation-card--interactive'
            role='button'
            tabIndex={0}
            onClick={(event) => openRecommendationDetails(recommendation, event)}
            onKeyDown={(event) => handleRecommendationCardKeyDown(recommendation, event)}
          >
            <div className='recommendation-card__header'>
              <div className='recommendation-card__copy'>
                <p className='eyebrow'>Recommended mint</p>
                <h3 title={recommendation.name || getMintLabel(recommendation.normalizedUrl)}>
                  {getMintLabel(recommendation.normalizedUrl, recommendation.name)}
                </h3>
                <p className='recommendation-card__url mono' title={recommendation.normalizedUrl}>
                  {truncateMiddle(recommendation.normalizedUrl, 22, 12)}
                </p>
              </div>

              <div className='chip-row recommendation-card__chips'>
                <span className={`pill ${recommendation.n_errors === 0 ? "pill--success" : "pill--warning"}`}>
                  {recommendation.n_errors === 0 ? "Healthy" : `${recommendation.n_errors} issues`}
                </span>
              </div>
            </div>

            <div className='recommendation-card__stats'>
              <div>
                <span>Pubkey</span>
                <strong className='mono' title={recommendation.parsedInfo.pubkey ?? "Unavailable"}>
                  {recommendation.parsedInfo.pubkey ? truncateMiddle(recommendation.parsedInfo.pubkey, 10, 10) : "Unavailable"}
                </strong>
              </div>
              <div>
                <span>Directory score</span>
                <strong>{formatSats(recommendation.directoryScore)}</strong>
              </div>
            </div>

            <div className='button-row recommendation-card__actions'>
              <button
                type='button'
                className='btn btn--ghost'
                onClick={(event) => openRecommendationDetails(recommendation, event)}
                disabled={busyKey !== null}
              >
                View details
              </button>
              <button
                type='button'
                className='btn btn--secondary'
                onClick={(event) => handleCardConnect(recommendation, event)}
                disabled={busyKey !== null}
              >
                Connect and trust
              </button>
            </div>
          </article>
        ))}
      </div>
    );
  }

  return (
    <section className='panel-stack'>
      <div className='section-card'>
        <div className='section-header'>
          <div>
            <p className='eyebrow'>Mint management</p>
            <h2>Register, trust, refresh, and prune Cashu mints</h2>
          </div>
        </div>

        <div className='section-stack'>
          <div className='section-stack__block'>
            <div className='section-copy'>
              <h3>Add a mint manually</h3>
              <p className='supporting-text'>
                You can still add any HTTPS Cashu mint URL directly when you want to test a mint outside the public recommendations list.
              </p>
            </div>

            <div className='form-grid'>
              <label className='field field--grow'>
                <span className='field__label'>Mint URL</span>
                <input
                  className='input mono'
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder='https://nofees.testnut.cashu.space'
                />
              </label>

              <button type='button' className='btn btn--primary' onClick={handleAddMint} disabled={busyKey !== null}>
                Add and trust
              </button>
            </div>
          </div>

          <div className='section-stack__block'>
            <div className='section-copy'>
              <h3>Discover audited mints</h3>
              <p className='supporting-text'>
                The shortlist below shows the top 8 mints ranked by directory score. Open any card to inspect the parsed mint metadata.
              </p>
              {discoverState.recommendations.length > 0 ? (
                <p className='supporting-text'>
                  {discoverState.recommendations.length} recommended mint{discoverState.recommendations.length === 1 ? "" : "s"} available.
                </p>
              ) : null}
            </div>

            {discoverState.error ? <p className='status-banner status-warning'>{discoverState.error}</p> : null}

            {discoverState.isLoading ? (
              <div className='section-card section-card--nested empty-state'>
                <h3>Loading mint recommendations</h3>
                <p>Fetching connectable mints from the public directory.</p>
              </div>
            ) : discoverState.recommendations.length === 0 ? (
              <div className='section-card section-card--nested empty-state'>
                <h3>No new directory mints to suggest</h3>
                <p>You have already added the currently recommended mints, or the directory is unavailable.</p>
              </div>
            ) : directoryView === "all" ? (
              <div className='section-stack__block'>
                <div className='section-header'>
                  <div className='section-copy'>
                    <h3>All available mints</h3>
                    <p className='supporting-text'>Search by mint name, URL, pubkey, or any parsed metadata field.</p>
                  </div>

                  <button
                    type='button'
                    className='btn btn--ghost'
                    onClick={() => {
                      setDirectoryView("featured");
                      setDirectorySearch("");
                    }}
                  >
                    Back to top 8
                  </button>
                </div>

                <label className='field field--grow'>
                  <span className='field__label'>Search mints</span>
                  <input
                    className='input'
                    value={directorySearch}
                    onChange={(event) => setDirectorySearch(event.target.value)}
                    placeholder='Search by name, URL, pubkey, or parsed detail'
                  />
                </label>

                {filteredRecommendations.length === 0 ? (
                  <div className='section-card section-card--nested empty-state'>
                    <h3>No matching mints</h3>
                    <p>Try a broader search term or return to the top-ranked shortlist.</p>
                  </div>
                ) : (
                  renderRecommendationGrid(filteredRecommendations)
                )}
              </div>
            ) : (
              <div className='section-stack__block'>
                {renderRecommendationGrid(featuredRecommendations)}

                {discoverState.recommendations.length > 8 ? (
                  <div className='button-row'>
                    <button type='button' className='btn btn--ghost' onClick={() => setDirectoryView("all")}>
                      Browse all mints
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <p className='supporting-text'>
          Existing mints are refreshed in place, so the same action also pulls down new keysets if a mint rotated them.
        </p>

        {statusMessage ? <p className='status-banner status-info'>{statusMessage}</p> : null}
      </div>

      <div className='mint-list'>
        {mintsState.mints.length === 0 ? (
          <div className='section-card empty-state'>
            <h3>No mints added yet</h3>
            <p>Add at least one trusted mint before you try the mint, melt, send, and receive flows.</p>
          </div>
        ) : null}

        {mintsState.mints.map((mint) => {
          const keysets = mintsState.keysetsByMint[mint.mintUrl] ?? [];
          const activeKeyset = keysets.find((keyset) => keyset.active);
          const balance = balancesState.byMint[mint.mintUrl];
          const canRemove = (balance?.controlled ?? 0) === 0 && !activeMintOperationUrls.has(mint.mintUrl);

          return (
            <article key={mint.mintUrl} className='section-card'>
              <div className='section-header'>
                <div>
                  <p className='eyebrow'>{getMintLabel(mint.mintUrl, mint.name)}</p>
                  <h3>{truncateMiddle(mint.mintUrl, 38, 18)}</h3>
                </div>
                <div className='chip-row'>
                  <span className={`pill ${mint.trusted ? "pill--success" : "pill--warning"}`}>{mint.trusted ? "Trusted" : "Untrusted"}</span>
                  <span className='pill'>{keysets.length} keysets</span>
                </div>
              </div>

              {mint.mintInfo.description ? <p className='supporting-text'>{mint.mintInfo.description}</p> : null}

              <div className='stat-grid'>
                <div className='stat-card'>
                  <span>Spendable</span>
                  <strong>{formatSats(balance?.spendable ?? 0)}</strong>
                </div>
                <div className='stat-card'>
                  <span>Reserved</span>
                  <strong>{formatSats(balance?.reserved ?? 0)}</strong>
                </div>
                <div className='stat-card'>
                  <span>Inflight</span>
                  <strong>{formatSats(balance?.inflight ?? 0)}</strong>
                </div>
                <div className='stat-card'>
                  <span>Proofs</span>
                  <strong>{balance?.proofCount ?? 0}</strong>
                </div>
              </div>

              <div className='key-value-grid'>
                <div>
                  <span>Active keyset</span>
                  <strong className='mono'>{activeKeyset ? truncateMiddle(activeKeyset.id, 16, 10) : "Unavailable"}</strong>
                </div>
                <div>
                  <span>Unit</span>
                  <strong>{activeKeyset?.unit ?? "sat"}</strong>
                </div>
                <div>
                  <span>Last updated</span>
                  <strong>{formatDateTime(mint.updatedAt)}</strong>
                </div>
                <div>
                  <span>Hostname</span>
                  <strong>{getMintLabel(mint.mintUrl)}</strong>
                </div>
              </div>

              <div className='button-row'>
                <button
                  type='button'
                  className='btn btn--secondary'
                  onClick={() => handleRefreshMint(mint.mintUrl, mint.trusted)}
                  disabled={busyKey !== null}
                >
                  Refresh metadata
                </button>
                <button
                  type='button'
                  className='btn btn--ghost'
                  onClick={() => handleToggleTrust(mint.mintUrl, mint.trusted)}
                  disabled={busyKey !== null}
                >
                  {mint.trusted ? "Untrust mint" : "Trust mint"}
                </button>
                <button
                  type='button'
                  className='btn btn--danger'
                  onClick={() => handleRemoveMint(mint.mintUrl)}
                  disabled={busyKey !== null || !canRemove}
                >
                  Remove empty mint
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {selectedRecommendation ? (
        <div className='modal-backdrop' role='presentation' onClick={closeRecommendationModal}>
          <div className='modal-card modal-card--mint-details' role='dialog' aria-modal='true' onClick={(event) => event.stopPropagation()}>
            <div className='section-header'>
              <div className='section-copy'>
                <p className='eyebrow'>Mint directory details</p>
                <h2>{getMintLabel(selectedRecommendation.normalizedUrl, selectedRecommendation.name)}</h2>
                <p className='recommendation-card__url mono' title={selectedRecommendation.normalizedUrl}>
                  {selectedRecommendation.normalizedUrl}
                </p>
              </div>

              <button type='button' className='btn btn--ghost' onClick={closeRecommendationModal}>
                Close
              </button>
            </div>

            <div className='stat-grid'>
              <div className='stat-card'>
                <span>Directory score</span>
                <strong>{formatSats(selectedRecommendation.directoryScore)}</strong>
              </div>
              <div className='stat-card'>
                <span>State</span>
                <strong>{selectedRecommendation.state}</strong>
              </div>
              <div className='stat-card'>
                <span>Errors</span>
                <strong>{selectedRecommendation.n_errors}</strong>
              </div>
            </div>

            <div className='mint-info-grid'>
              {selectedRecommendation.parsedInfo.entries.map((entry) => (
                <div key={`${entry.path}-${entry.value}`} className='mint-info-row'>
                  <span>{formatEntryLabel(entry.path)}</span>
                  <strong className='mono'>{entry.value}</strong>
                </div>
              ))}
            </div>

            <div className='button-row'>
              <button
                type='button'
                className='btn btn--secondary'
                onClick={(event) => handleCardConnect(selectedRecommendation, event)}
                disabled={busyKey !== null}
              >
                Connect and trust
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
