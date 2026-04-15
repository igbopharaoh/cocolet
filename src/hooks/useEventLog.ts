import { useEffect, useState } from "react";
import { useCoco } from "./useCoco";
import { usePageVisibility } from "./usePageVisibility";

const EVENT_NAMES = [
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
  "melt-quote:created",
  "melt-quote:state-changed",
  "melt-quote:paid",
  "send:prepared",
  "send:pending",
  "send:finalized",
  "send:rolled-back",
  "receive:created",
  "history:updated",
  "melt-op:prepared",
  "melt-op:pending",
  "melt-op:finalized",
  "melt-op:rolled-back",
  "mint-op:pending",
  "mint-op:quote-state-changed",
  "mint-op:executing",
  "mint-op:finalized",
  "counter:updated",
  "subscriptions:paused",
  "subscriptions:resumed",
] as const;

export type DebugLogEntry = {
  id: string;
  timestamp: string;
  event: string;
  payload: string;
};

export type UseEventLogResult = {
  entries: DebugLogEntry[];
  clear: () => void;
};

type SerializableValue =
  | null
  | boolean
  | number
  | string
  | SerializableValue[]
  | { [key: string]: SerializableValue };

function summarizeValue(value: unknown, depth = 0): SerializableValue {
  if (value === null || value === undefined) {
    return value ?? null;
  }

  if (typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return value.length > 180 ? `${value.slice(0, 177)}...` : value;
  }

  if (depth >= 2) {
    return "[truncated]";
  }

  if (Array.isArray(value)) {
    const preview = value.slice(0, 6).map((item) => summarizeValue(item, depth + 1));
    return value.length > 6 ? [...preview, `… ${value.length - 6} more`] : preview;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const limited = entries
      .slice(0, 8)
      .map(([key, nestedValue]) => [key, summarizeValue(nestedValue, depth + 1)] as const);
    const result = Object.fromEntries(limited) as Record<string, SerializableValue>;

    if (entries.length > 8) {
      result.__truncated__ = `${entries.length - 8} more fields`;
    }

    return result;
  }

  try {
    return String(value);
  } catch {
    return "[unserializable payload]";
  }
}

function serializePayload(payload: unknown): string {
  if (payload === undefined) {
    return "void";
  }

  try {
    return JSON.stringify(summarizeValue(payload));
  } catch {
    return "[unserializable payload]";
  }
}

export function useEventLog(enabled = true): UseEventLogResult {
  const { manager } = useCoco();
  const isPageVisible = usePageVisibility();
  const [entries, setEntries] = useState<DebugLogEntry[]>([]);

  useEffect(() => {
    if (!enabled || !isPageVisible) {
      setEntries([]);
      return undefined;
    }

    setEntries([]);

    const unsubscribers = EVENT_NAMES.map((eventName) =>
      manager.on(eventName, (payload) => {
        setEntries((current) => [
          {
            id: `${eventName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            timestamp: new Date().toLocaleTimeString(),
            event: eventName,
            payload: serializePayload(payload),
          },
          ...current,
        ].slice(0, 120));
      }),
    );

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [enabled, isPageVisible, manager]);

  return {
    entries,
    clear: () => setEntries([]),
  };
}
