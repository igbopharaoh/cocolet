import { startTransition, useEffect, useState } from "react";
import type {
  MeltOperation,
  MeltOpsApi,
  MintOpsApi,
  MintOperation,
  ReceiveOpsApi,
  PreparedSendOperation,
  ReceiveOperation,
  SendOperation,
} from "@cashu/coco-core";
import { useCoco } from "./useCoco";
import { useCoalescedRefresh } from "./useCoalescedRefresh";
import { usePageVisibility } from "./usePageVisibility";
import { toErrorMessage } from "../lib/errors";

type PreparedMeltOperation = Awaited<ReturnType<MeltOpsApi["prepare"]>>;
type PreparedReceiveOperation = Awaited<ReturnType<ReceiveOpsApi["prepare"]>>;
type PendingMintOperation = Awaited<ReturnType<MintOpsApi["prepare"]>>;

const OPERATION_EVENTS = [
  "send:prepared",
  "send:pending",
  "send:finalized",
  "send:rolled-back",
  "melt-op:prepared",
  "melt-op:pending",
  "melt-op:finalized",
  "melt-op:rolled-back",
  "mint-op:pending",
  "mint-op:executing",
  "mint-op:quote-state-changed",
  "mint-op:finalized",
  "proofs:reserved",
  "proofs:released",
  "history:updated",
] as const;

type OperationState<TPrepared, TInFlight> = {
  prepared: TPrepared[];
  inFlight: TInFlight[];
};

export type UseOperationsResult = {
  send: OperationState<PreparedSendOperation, SendOperation>;
  melt: OperationState<PreparedMeltOperation, MeltOperation>;
  receive: OperationState<PreparedReceiveOperation, ReceiveOperation>;
  mint: {
    pending: PendingMintOperation[];
    inFlight: MintOperation[];
  };
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useOperations(): UseOperationsResult {
  const { manager } = useCoco();
  const isPageVisible = usePageVisibility();
  const [state, setState] = useState<UseOperationsResult>({
    send: { prepared: [], inFlight: [] },
    melt: { prepared: [], inFlight: [] },
    receive: { prepared: [], inFlight: [] },
    mint: { pending: [], inFlight: [] },
    isLoading: true,
    error: null,
    refresh: async () => undefined,
  });

  const refresh = useCoalescedRefresh(async () => {
    startTransition(() => {
      setState((current) => ({ ...current, isLoading: true }));
    });

    try {
      const [
        preparedSends,
        inFlightSends,
        preparedMelts,
        inFlightMelts,
        preparedReceives,
        inFlightReceives,
        pendingMints,
        inFlightMints,
      ] = await Promise.all([
        manager.ops.send.listPrepared(),
        manager.ops.send.listInFlight(),
        manager.ops.melt.listPrepared(),
        manager.ops.melt.listInFlight(),
        manager.ops.receive.listPrepared(),
        manager.ops.receive.listInFlight(),
        manager.ops.mint.listPending(),
        manager.ops.mint.listInFlight(),
      ]);

      startTransition(() => {
        setState({
          send: {
            prepared: preparedSends.sort((left, right) => right.updatedAt - left.updatedAt),
            inFlight: inFlightSends.sort((left, right) => right.updatedAt - left.updatedAt),
          },
          melt: {
            prepared: preparedMelts.sort((left, right) => right.updatedAt - left.updatedAt),
            inFlight: inFlightMelts.sort((left, right) => right.updatedAt - left.updatedAt),
          },
          receive: {
            prepared: preparedReceives.sort((left, right) => right.updatedAt - left.updatedAt),
            inFlight: inFlightReceives.sort((left, right) => right.updatedAt - left.updatedAt),
          },
          mint: {
            pending: pendingMints.sort((left, right) => right.updatedAt - left.updatedAt),
            inFlight: inFlightMints.sort((left, right) => right.updatedAt - left.updatedAt),
          },
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

    const unsubscribers = OPERATION_EVENTS.map((eventName) => manager.on(eventName, () => refresh()));
    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [isPageVisible, manager, refresh]);

  return {
    ...state,
    refresh: async () => refresh(),
  };
}
