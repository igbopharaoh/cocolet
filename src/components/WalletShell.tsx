import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bug,
  Coins,
  FlaskConical,
  Landmark,
  LockKeyhole,
  RefreshCw,
  Settings2,
  Wallet,
} from "lucide-react";
import { useBalances } from "../hooks/useBalances";
import { useEventLog } from "../hooks/useEventLog";
import { useHistory } from "../hooks/useHistory";
import { useMints } from "../hooks/useMints";
import { useOperations } from "../hooks/useOperations";
import { formatDateTime, formatSats, getMintLabel } from "../lib/format";

const MintManager = lazy(() => import("./MintManager").then((module) => ({ default: module.MintManager })));
const MintFlow = lazy(() => import("./MintFlow").then((module) => ({ default: module.MintFlow })));
const MeltFlow = lazy(() => import("./MeltFlow").then((module) => ({ default: module.MeltFlow })));
const SendFlow = lazy(() => import("./SendFlow").then((module) => ({ default: module.SendFlow })));
const ReceiveFlow = lazy(() => import("./ReceiveFlow").then((module) => ({ default: module.ReceiveFlow })));
const DebugPanel = lazy(() => import("./DebugPanel").then((module) => ({ default: module.DebugPanel })));
const AdversarialPanel = lazy(() =>
  import("./AdversarialPanel").then((module) => ({ default: module.AdversarialPanel })),
);
const SettingsPanel = lazy(() => import("./SettingsPanel").then((module) => ({ default: module.SettingsPanel })));

const TABS = [
  { id: "mints", label: "Mints", icon: Landmark },
  { id: "mint", label: "Mint", icon: ArrowDownLeft },
  { id: "melt", label: "Melt", icon: ArrowUpRight },
  { id: "send", label: "Send", icon: Coins },
  { id: "receive", label: "Receive", icon: Wallet },
  { id: "debug", label: "Debug", icon: Bug },
  { id: "lab", label: "Adversarial", icon: FlaskConical },
  { id: "settings", label: "Settings", icon: Settings2 },
] as const;

type TabId = (typeof TABS)[number]["id"];

const TAB_STORAGE_KEY = "cocolet:active-tab";

function isTabId(value: string | null): value is TabId {
  return TABS.some((tab) => tab.id === value);
}

type WalletShellProps = {
  currentMnemonic: string;
  onLock: () => void;
  onVaultReplaced: (mnemonic: string) => void;
};

export function WalletShell({ currentMnemonic, onLock, onVaultReplaced }: WalletShellProps) {
  const [tab, setTab] = useState<TabId>(() => {
    const stored = localStorage.getItem(TAB_STORAGE_KEY);
    return isTabId(stored) ? stored : "mints";
  });

  const mintsState = useMints();
  const balancesState = useBalances();
  const historyState = useHistory(120);
  const operationsState = useOperations();
  const eventLogState = useEventLog(tab === "debug");

  useEffect(() => {
    localStorage.setItem(TAB_STORAGE_KEY, tab);
  }, [tab]);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      mintsState.refresh(),
      balancesState.refresh(),
      historyState.refresh(),
      operationsState.refresh(),
    ]);
  }, [balancesState, historyState, mintsState, operationsState]);

  const activeOperationCount =
    operationsState.send.prepared.length +
    operationsState.send.inFlight.length +
    operationsState.melt.prepared.length +
    operationsState.melt.inFlight.length +
    operationsState.receive.prepared.length +
    operationsState.receive.inFlight.length +
    operationsState.mint.pending.length +
    operationsState.mint.inFlight.length;

  const mintCards = useMemo(() => {
    const mintUrls = Array.from(
      new Set([...mintsState.mints.map((mint) => mint.mintUrl), ...Object.keys(balancesState.byMint)]),
    );

    return mintUrls.map((mintUrl) => ({
      mint: mintsState.mints.find((item) => item.mintUrl === mintUrl),
      balance: balancesState.byMint[mintUrl],
    }));
  }, [balancesState.byMint, mintsState.mints]);

  const latestHistoryEntry = historyState.entries[0] ?? null;
  const errors = [mintsState.error, balancesState.error, historyState.error, operationsState.error].filter(Boolean);

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero__copy">
          <p className="eyebrow">Cocolet</p>
          <h1>Cashu wallet operations with protocol-grade introspection.</h1>
          <p className="supporting-text">
            Built against the current coco RC line, with recovery-aware flows, live event logging,
            and an adversarial panel for failure drills.
          </p>
        </div>

        <div className="hero__actions">
          <button type="button" className="btn btn--secondary" onClick={() => void refreshAll()}>
            <RefreshCw className="btn__icon" />
            Refresh
          </button>
          <button type="button" className="btn btn--ghost" onClick={onLock}>
            <LockKeyhole className="btn__icon" />
            Lock
          </button>
        </div>

        <div className="summary-grid">
          <div className="summary-card summary-card--feature">
            <span>Spendable</span>
            <strong>{formatSats(balancesState.totalSpendable)}</strong>
          </div>
          <div className="summary-card summary-card--feature">
            <span>Reserved</span>
            <strong>{formatSats(balancesState.totalReserved)}</strong>
          </div>
          <div className="summary-card summary-card--feature">
            <span>Inflight</span>
            <strong>{formatSats(balancesState.totalInflight)}</strong>
          </div>
          <div className="summary-card summary-card--feature">
            <span>Active operations</span>
            <strong>{activeOperationCount}</strong>
          </div>
        </div>

        {latestHistoryEntry ? (
          <p className="supporting-text">
            Latest activity: {latestHistoryEntry.type} on {getMintLabel(latestHistoryEntry.mintUrl)} at{" "}
            {formatDateTime(latestHistoryEntry.createdAt)}.
          </p>
        ) : null}
      </header>

      {errors.length > 0 ? (
        <div className="panel-stack">
          {errors.map((error) => (
            <p key={error} className="status-banner status-error">
              {error}
            </p>
          ))}
        </div>
      ) : null}

      <section className="mint-strip">
        {mintCards.length === 0 ? (
          <div className="section-card empty-state">
            <h3>No mints configured yet</h3>
            <p>Head to the Mints tab to add one and begin testing the wallet.</p>
          </div>
        ) : (
          mintCards.map(({ mint, balance }) => (
            <article key={mint?.mintUrl ?? balance?.mintUrl} className="section-card mint-strip__card">
              <p className="eyebrow">{getMintLabel(mint?.mintUrl ?? balance?.mintUrl ?? "")}</p>
              <strong>{formatSats(balance?.spendable ?? 0)}</strong>
              <span>
                {mint?.trusted ? "trusted" : "untrusted"} / {balance?.proofCount ?? 0} proofs
              </span>
            </article>
          ))
        )}
      </section>

      <div className="workspace">
        <nav className="tab-rail" aria-label="Wallet sections">
          {TABS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={clsx("tab-button", tab === item.id && "tab-button--active")}
                onClick={() => setTab(item.id)}
              >
                <Icon className="tab-button__icon" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <main className="workspace__main">
          <Suspense
            fallback={
              <div className="section-card empty-state">
                <h3>Loading panel</h3>
                <p>Preparing the selected wallet workspace.</p>
              </div>
            }
          >
            {tab === "mints" ? (
              <MintManager
                mintsState={mintsState}
                balancesState={balancesState}
                operationsState={operationsState}
                onRefreshAll={refreshAll}
              />
            ) : null}
            {tab === "mint" ? <MintFlow mintsState={mintsState} onRefreshAll={refreshAll} /> : null}
            {tab === "melt" ? <MeltFlow mintsState={mintsState} onRefreshAll={refreshAll} /> : null}
            {tab === "send" ? <SendFlow mintsState={mintsState} onRefreshAll={refreshAll} /> : null}
            {tab === "receive" ? <ReceiveFlow onRefreshAll={refreshAll} /> : null}
            {tab === "debug" ? (
              <DebugPanel
                balancesState={balancesState}
                historyState={historyState}
                operationsState={operationsState}
                eventLogState={eventLogState}
                onRefreshAll={refreshAll}
              />
            ) : null}
            {tab === "lab" ? <AdversarialPanel mintsState={mintsState} onRefreshAll={refreshAll} /> : null}
            {tab === "settings" ? (
              <SettingsPanel
                currentMnemonic={currentMnemonic}
                mintsState={mintsState}
                onLock={onLock}
                onVaultReplaced={onVaultReplaced}
                onRefreshAll={refreshAll}
              />
            ) : null}
          </Suspense>
        </main>
      </div>
    </div>
  );
}
