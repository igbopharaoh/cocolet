import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import type { Manager } from "@cashu/coco-core";
import type { IndexedDbRepositories } from "@cashu/coco-indexeddb";
import { destroyWalletRuntime, getWalletRuntime } from "../coco/manager";
import { usePageVisibility } from "./usePageVisibility";
import { toErrorMessage } from "../lib/errors";

type CocoContextValue = {
  manager: Manager;
  repo: IndexedDbRepositories;
  recoverOperations: () => Promise<void>;
};

const CocoContext = createContext<CocoContextValue | null>(null);

async function runRecoveries(manager: Manager): Promise<void> {
  await Promise.allSettled([
    manager.ops.mint.recovery.run(),
    manager.ops.melt.recovery.run(),
    manager.ops.send.recovery.run(),
    manager.ops.receive.recovery.run(),
  ]);
}

type CocoProviderProps = PropsWithChildren<{
  mnemonic: string;
}>;

export function CocoProvider({ mnemonic, children }: CocoProviderProps) {
  const [contextValue, setContextValue] = useState<CocoContextValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isPageVisible = usePageVisibility();
  console.log({ mnemonic });

  useEffect(() => {
    let cancelled = false;

    setContextValue(null);
    setError(null);

    void (async () => {
      try {
        const { manager, repo } = await getWalletRuntime(mnemonic);
        console.log({ manager, repo });

        if (cancelled) {
          console.log("cancelled");
          return;
        }

        console.log("setting context value");
        setContextValue({
          manager,
          repo,
          recoverOperations: async () => runRecoveries(manager),
        });

        console.log("running recoveries");
        await runRecoveries(manager);
      } catch (initError) {
        if (!cancelled) {
          setError(toErrorMessage(initError));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mnemonic]);

  useEffect(() => {
    return () => {
      void destroyWalletRuntime();
    };
  }, []);

  useEffect(() => {
    if (!contextValue) {
      return undefined;
    }

    let paused = false;
    let pausedByVisibility = false;

    const unsubscribePaused = contextValue.manager.on("subscriptions:paused", () => {
      paused = true;
    });
    const unsubscribeResumed = contextValue.manager.on("subscriptions:resumed", () => {
      paused = false;
    });

    const syncVisibility = async () => {
      if (!isPageVisible) {
        if (!paused) {
          pausedByVisibility = true;
          await contextValue.manager.pauseSubscriptions().catch(() => undefined);
        }

        return;
      }

      if (pausedByVisibility) {
        pausedByVisibility = false;
        await contextValue.manager.resumeSubscriptions().catch(() => undefined);
      }
    };

    void syncVisibility();

    return () => {
      unsubscribePaused();
      unsubscribeResumed();

      if (pausedByVisibility) {
        void contextValue.manager.resumeSubscriptions().catch(() => undefined);
      }
    };
  }, [contextValue, isPageVisible]);

  console.log("contextValue", contextValue);

  const content = useMemo(() => {
    if (error) {
      return (
        <div className='gate-shell'>
          <div className='gate-card'>
            <p className='eyebrow'>Wallet initialization failed</p>
            <h1>We couldn&apos;t start the coco runtime.</h1>
            <p className='supporting-text'>{error}</p>
          </div>
        </div>
      );
    }

    if (!contextValue) {
      return (
        <div className='gate-shell'>
          <div className='gate-card'>
            <p className='eyebrow'>Starting wallet</p>
            <h1>Rehydrating the local Cashu wallet.</h1>
            <p className='supporting-text'>Recovering any unfinished mint, send, melt, and receive operations before the UI comes online.</p>
          </div>
        </div>
      );
    }

    return <CocoContext.Provider value={contextValue}>{children}</CocoContext.Provider>;
  }, [children, contextValue, error]);

  return content;
}

export function useCoco(): CocoContextValue {
  const value = useContext(CocoContext);

  if (!value) {
    throw new Error("useCoco must be used inside CocoProvider.");
  }

  return value;
}
