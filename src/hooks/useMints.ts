import { startTransition, useEffect, useState } from "react";
import type { Keyset, Mint } from "@cashu/coco-core";
import { useCoco } from "./useCoco";
import { useCoalescedRefresh } from "./useCoalescedRefresh";
import { usePageVisibility } from "./usePageVisibility";
import { toErrorMessage } from "../lib/errors";

const MINT_EVENTS = ["mint:added", "mint:updated", "mint:trusted", "mint:untrusted"] as const;

export type UseMintsResult = {
  mints: Mint[];
  keysetsByMint: Record<string, Keyset[]>;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useMints(): UseMintsResult {
  const { manager, repo } = useCoco();
  const isPageVisible = usePageVisibility();
  const [mints, setMints] = useState<Mint[]>([]);
  const [keysetsByMint, setKeysetsByMint] = useState<Record<string, Keyset[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCoalescedRefresh(async () => {
    setIsLoading(true);

    try {
      const nextMints = (await manager.mint.getAllMints()).sort((left, right) =>
        left.mintUrl.localeCompare(right.mintUrl),
      );
      const keysetEntries = await Promise.all(
        nextMints.map(async (mint) => [
          mint.mintUrl,
          await repo.keysetRepository.getKeysetsByMintUrl(mint.mintUrl),
        ] as const),
      );

      startTransition(() => {
        setMints(nextMints);
        setKeysetsByMint(Object.fromEntries(keysetEntries));
        setError(null);
        setIsLoading(false);
      });
    } catch (nextError) {
      startTransition(() => {
        setError(toErrorMessage(nextError));
        setIsLoading(false);
      });
    }
  });

  useEffect(() => {
    if (!isPageVisible) {
      return undefined;
    }

    void refresh();

    const unsubscribers = MINT_EVENTS.map((eventName) => manager.on(eventName, () => refresh()));
    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [isPageVisible, manager, refresh]);

  return { mints, keysetsByMint, isLoading, error, refresh };
}
