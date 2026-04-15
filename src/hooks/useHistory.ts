import { startTransition, useEffect, useState } from "react";
import type { HistoryEntry } from "@cashu/coco-core";
import { useCoco } from "./useCoco";
import { useCoalescedRefresh } from "./useCoalescedRefresh";
import { usePageVisibility } from "./usePageVisibility";
import { toErrorMessage } from "../lib/errors";

export type UseHistoryResult = {
  entries: HistoryEntry[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useHistory(limit = 100): UseHistoryResult {
  const { manager } = useCoco();
  const isPageVisible = usePageVisibility();
  const [state, setState] = useState<UseHistoryResult>({
    entries: [],
    isLoading: true,
    error: null,
    refresh: async () => undefined,
  });

  const refresh = useCoalescedRefresh(async () => {
    startTransition(() => {
      setState((current) => ({ ...current, isLoading: true }));
    });

    try {
      const entries = await manager.history.getPaginatedHistory(0, limit);
      startTransition(() => {
        setState({
          entries,
          isLoading: false,
          error: null,
          refresh: async () => refresh(),
        });
      });
    } catch (nextError) {
      startTransition(() => {
        setState((current) => ({
          ...current,
          isLoading: false,
          error: toErrorMessage(nextError),
          refresh: async () => refresh(),
        }));
      });
    }
  });

  useEffect(() => {
    if (!isPageVisible) {
      return undefined;
    }

    void refresh();
    const unsubscribe = manager.on("history:updated", () => refresh());
    return () => unsubscribe();
  }, [isPageVisible, manager, refresh]);

  return {
    ...state,
    refresh: async () => refresh(),
  };
}
