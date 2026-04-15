import { startTransition, useEffect, useState } from "react";
import { useCoco } from "./useCoco";
import { useCoalescedRefresh } from "./useCoalescedRefresh";
import { usePageVisibility } from "./usePageVisibility";
import { toErrorMessage } from "../lib/errors";

const BALANCE_EVENTS = [
  "mint:added",
  "mint:updated",
  "mint:trusted",
  "mint:untrusted",
  "proofs:saved",
  "proofs:state-changed",
  "proofs:deleted",
  "proofs:wiped",
  "proofs:reserved",
  "proofs:released",
] as const;

export type MintBalanceSnapshot = {
  mintUrl: string;
  spendable: number;
  reserved: number;
  inflight: number;
  controlled: number;
  proofCount: number;
};

export type UseBalancesResult = {
  byMint: Record<string, MintBalanceSnapshot>;
  totalSpendable: number;
  totalReserved: number;
  totalInflight: number;
  totalControlled: number;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

function accumulateByMint(
  proofs: Array<{ mintUrl: string; amount: number }>,
): Record<string, { amount: number; count: number }> {
  return proofs.reduce<Record<string, { amount: number; count: number }>>((result, proof) => {
    const current = result[proof.mintUrl] ?? { amount: 0, count: 0 };
    current.amount += proof.amount;
    current.count += 1;
    result[proof.mintUrl] = current;
    return result;
  }, {});
}

export function useBalances(): UseBalancesResult {
  const { manager, repo } = useCoco();
  const isPageVisible = usePageVisibility();
  const [state, setState] = useState<UseBalancesResult>({
    byMint: {},
    totalSpendable: 0,
    totalReserved: 0,
    totalInflight: 0,
    totalControlled: 0,
    isLoading: true,
    error: null,
    refresh: async () => undefined,
  });

  const refresh = useCoalescedRefresh(async () => {
    startTransition(() => {
      setState((current) => ({ ...current, isLoading: true }));
    });

    try {
      const [mints, readyProofs, reservedProofs, inflightProofs] = await Promise.all([
        manager.mint.getAllMints(),
        repo.proofRepository.getAllReadyProofs(),
        repo.proofRepository.getReservedProofs(),
        repo.proofRepository.getInflightProofs(),
      ]);

      const readyByMint = accumulateByMint(readyProofs);
      const reservedByMint = accumulateByMint(reservedProofs);
      const inflightByMint = accumulateByMint(inflightProofs);
      const mintUrls = new Set([
        ...mints.map((mint) => mint.mintUrl),
        ...Object.keys(readyByMint),
        ...Object.keys(inflightByMint),
      ]);

      const byMint = [...mintUrls].sort().reduce<Record<string, MintBalanceSnapshot>>((result, mintUrl) => {
        const ready = readyByMint[mintUrl]?.amount ?? 0;
        const reserved = reservedByMint[mintUrl]?.amount ?? 0;
        const inflight = inflightByMint[mintUrl]?.amount ?? 0;
        const proofCount =
          (readyByMint[mintUrl]?.count ?? 0) +
          (inflightByMint[mintUrl]?.count ?? 0);

        result[mintUrl] = {
          mintUrl,
          spendable: Math.max(ready - reserved, 0),
          reserved,
          inflight,
          controlled: ready + inflight,
          proofCount,
        };

        return result;
      }, {});

      const totals = Object.values(byMint).reduce(
        (result, balance) => ({
          spendable: result.spendable + balance.spendable,
          reserved: result.reserved + balance.reserved,
          inflight: result.inflight + balance.inflight,
          controlled: result.controlled + balance.controlled,
        }),
        { spendable: 0, reserved: 0, inflight: 0, controlled: 0 },
      );

      startTransition(() => {
        setState({
          byMint,
          totalSpendable: totals.spendable,
          totalReserved: totals.reserved,
          totalInflight: totals.inflight,
          totalControlled: totals.controlled,
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

    const unsubscribers = BALANCE_EVENTS.map((eventName) => manager.on(eventName, () => refresh()));
    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [isPageVisible, manager, refresh]);

  return {
    ...state,
    refresh: async () => refresh(),
  };
}
