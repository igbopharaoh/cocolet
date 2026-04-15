import { ConsoleLogger, initializeCoco, type Manager } from "@cashu/coco-core";
import { IndexedDbRepositories } from "@cashu/coco-indexeddb";
import { mnemonicToSeedBytes, normalizeMnemonic } from "./seed";

export const COCO_DB_NAME = "cocolet-wallet";

type WalletRuntime = {
  manager: Manager;
  repo: IndexedDbRepositories;
};

let runtimePromise: Promise<WalletRuntime> | null = null;
let activeMnemonic: string | null = null;

function createLogger(): ConsoleLogger {
  return new ConsoleLogger("cocolet", {
    level: import.meta.env.DEV ? "debug" : "info",
  });
}

export async function getWalletRuntime(mnemonic: string): Promise<WalletRuntime> {
  const normalizedMnemonic = normalizeMnemonic(mnemonic);

  if (runtimePromise && normalizedMnemonic === activeMnemonic) {
    return runtimePromise;
  }

  await destroyWalletRuntime();

  const repo = new IndexedDbRepositories({ name: COCO_DB_NAME });
  const logger = createLogger();

  activeMnemonic = normalizedMnemonic;
  runtimePromise = initializeCoco({
    repo,
    seedGetter: async () => mnemonicToSeedBytes(normalizedMnemonic),
    logger,
    webSocketFactory:
      typeof window === "undefined"
        ? undefined
        : (url: string) => new WebSocket(url),
    watchers: {
      mintOperationWatcher: {
        disabled: false,
        watchExistingPendingOnStart: true,
      },
      proofStateWatcher: {
        disabled: false,
        watchExistingInflightOnStart: true,
      },
    },
    processors: {
      mintOperationProcessor: {
        disabled: false,
        processIntervalMs: 3_000,
        baseRetryDelayMs: 1_000,
        maxRetries: 6,
      },
    },
    subscriptions: {
      slowPollingIntervalMs: 20_000,
      fastPollingIntervalMs: 5_000,
    },
  })
    .then((manager) => ({ manager, repo }))
    .catch((error) => {
      runtimePromise = null;
      activeMnemonic = null;
      throw error;
    });

  return runtimePromise;
}

export async function destroyWalletRuntime(): Promise<void> {
  if (!runtimePromise) {
    return;
  }

  const runtime = await runtimePromise.catch(() => null);
  runtimePromise = null;
  activeMnemonic = null;

  if (runtime) {
    await runtime.manager.dispose().catch(() => undefined);
  }
}

export async function deleteWalletDatabase(): Promise<void> {
  await destroyWalletRuntime();
  const repo = new IndexedDbRepositories({ name: COCO_DB_NAME });
  await repo.db.delete();
}
