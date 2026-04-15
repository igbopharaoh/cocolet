import { useEffectEvent, useRef } from "react";

export function useCoalescedRefresh(task: () => Promise<void>): () => Promise<void> {
  const taskEvent = useEffectEvent(task);
  const isRunningRef = useRef(false);
  const needsReplayRef = useRef(false);

  return useEffectEvent(async () => {
    if (isRunningRef.current) {
      needsReplayRef.current = true;
      return;
    }

    isRunningRef.current = true;

    try {
      do {
        needsReplayRef.current = false;
        await taskEvent();
      } while (needsReplayRef.current);
    } finally {
      isRunningRef.current = false;
    }
  });
}
