import type { Manager } from "@cashu/coco-core";
import { NetworkError, type RequestFn, type RequestOptions } from "@cashu/cashu-ts";

export type FaultKind =
  | "network_failure"
  | "partial_mint_response"
  | "invalid_signatures"
  | "keyset_rotation_mid_operation";

export type FaultEndpoint = "info" | "keysets" | "keys" | "swap" | "mint" | "melt" | "restore";

export type FaultDescriptor = {
  id: string;
  kind: FaultKind;
  mintUrl: string;
  endpoint: FaultEndpoint;
  armedAt: number;
  description: string;
};

type FaultRecord = FaultDescriptor & {
  remaining: number;
};

type MintRequestProviderLike = {
  getRequestFn: (mintUrl: string) => RequestFn;
};

type ManagerWithPrivateRequestProvider = {
  mintRequestProvider?: MintRequestProviderLike;
};

type Listener = () => void;

const faults = new Map<string, FaultRecord>();
const listeners = new Set<Listener>();
const instrumentedManagers = new WeakSet<object>();
let faultsSnapshot: FaultDescriptor[] = [];

function emitChange(): void {
  faultsSnapshot = [...faults.values()]
    .sort((left, right) => left.armedAt - right.armedAt)
    .map(({ remaining: _remaining, ...descriptor }) => descriptor);

  for (const listener of listeners) {
    listener();
  }
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function generateFaultId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `fault-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getEndpointPath(endpoint: string): string {
  try {
    return new URL(endpoint).pathname;
  } catch {
    return endpoint;
  }
}

function getFaultEndpoint(endpoint: string): FaultEndpoint | null {
  const path = getEndpointPath(endpoint);

  if (path.endsWith("/v1/info")) {
    return "info";
  }

  if (path.endsWith("/v1/keysets")) {
    return "keysets";
  }

  if (path.includes("/v1/keys")) {
    return "keys";
  }

  if (path.endsWith("/v1/swap")) {
    return "swap";
  }

  if (path.includes("/v1/mint/")) {
    return "mint";
  }

  if (path.includes("/v1/melt/")) {
    return "melt";
  }

  if (path.endsWith("/v1/restore")) {
    return "restore";
  }

  return null;
}

function rotateIdentifier(identifier: string): string {
  if (!identifier) {
    return "00";
  }

  const tail = identifier.at(-1)?.toLowerCase() ?? "0";
  const replacement = tail === "f" ? "0" : Number.isNaN(Number.parseInt(tail, 16)) ? "f" : "f";
  return `${identifier.slice(0, -1)}${replacement}`;
}

function consumeFault(id: string): void {
  const record = faults.get(id);

  if (!record) {
    return;
  }

  if (record.remaining <= 1) {
    faults.delete(id);
  } else {
    faults.set(id, { ...record, remaining: record.remaining - 1 });
  }

  emitChange();
}

function findMatchingFault(mintUrl: string, endpoint: FaultEndpoint | null): FaultRecord | null {
  if (!endpoint) {
    return null;
  }

  const normalizedMintUrl = normalizeUrl(mintUrl);
  const queued = [...faults.values()]
    .filter((fault) => normalizeUrl(fault.mintUrl) === normalizedMintUrl && fault.endpoint === endpoint)
    .sort((left, right) => left.armedAt - right.armedAt);

  return queued[0] ?? null;
}

function tamperSignatures(response: unknown): unknown {
  if (!isRecord(response)) {
    return response;
  }

  if (Array.isArray(response.signatures) && response.signatures.length > 0) {
    return {
      ...response,
      signatures: response.signatures.map((signature, index) =>
        index === 0 && isRecord(signature)
          ? {
              ...signature,
              C_: "00",
            }
          : signature,
      ),
    };
  }

  if (Array.isArray(response.change) && response.change.length > 0) {
    return {
      ...response,
      change: response.change.map((signature, index) =>
        index === 0 && isRecord(signature)
          ? {
              ...signature,
              C_: "00",
            }
          : signature,
      ),
    };
  }

  return response;
}

function createPartialResponse(response: unknown, endpoint: FaultEndpoint): unknown {
  if (!isRecord(response)) {
    return {};
  }

  switch (endpoint) {
    case "swap":
    case "mint":
      return {
        ...response,
        signatures: [],
      };
    case "restore":
      return {
        ...response,
        outputs: Array.isArray(response.outputs) ? response.outputs.slice(0, 1) : [],
        signatures: [],
      };
    case "melt":
      return {
        ...response,
        state: undefined,
      };
    case "keysets":
    case "keys":
      return {};
    case "info":
      return {};
    default:
      return response;
  }
}

function createRotatedKeysetResponse(response: unknown): unknown {
  if (!isRecord(response) || !Array.isArray(response.keysets) || response.keysets.length === 0) {
    return {};
  }

  const targetIndex = response.keysets.findIndex((keyset) => isRecord(keyset) && keyset.active === true);
  const safeIndex = targetIndex >= 0 ? targetIndex : 0;

  return {
    ...response,
    keysets: response.keysets.map((keyset, index) => {
      if (!isRecord(keyset) || index !== safeIndex || typeof keyset.id !== "string") {
        return keyset;
      }

      return {
        ...keyset,
        id: rotateIdentifier(keyset.id),
      };
    }),
  };
}

function applyFault(record: FaultRecord, response: unknown): unknown {
  switch (record.kind) {
    case "network_failure":
      throw new NetworkError(
        `Simulated network failure for ${record.endpoint} on ${record.mintUrl}`,
      );
    case "partial_mint_response":
      return createPartialResponse(response, record.endpoint);
    case "invalid_signatures":
      return tamperSignatures(response);
    case "keyset_rotation_mid_operation":
      return createRotatedKeysetResponse(response);
    default:
      return response;
  }
}

export function describeFaultKind(kind: FaultKind): string {
  switch (kind) {
    case "network_failure":
      return "Network failure";
    case "partial_mint_response":
      return "Partial response";
    case "invalid_signatures":
      return "Invalid signatures";
    case "keyset_rotation_mid_operation":
      return "Keyset rotation";
    default:
      return kind;
  }
}

export function describeFaultEndpoint(endpoint: FaultEndpoint): string {
  switch (endpoint) {
    case "info":
      return "/v1/info";
    case "keysets":
      return "/v1/keysets";
    case "keys":
      return "/v1/keys";
    case "swap":
      return "/v1/swap";
    case "mint":
      return "/v1/mint/*";
    case "melt":
      return "/v1/melt/*";
    case "restore":
      return "/v1/restore";
    default:
      return endpoint;
  }
}

export function queueFault(input: {
  kind: FaultKind;
  mintUrl: string;
  endpoint: FaultEndpoint;
  description?: string;
}): FaultDescriptor {
  const descriptor: FaultRecord = {
    id: generateFaultId(),
    kind: input.kind,
    mintUrl: normalizeUrl(input.mintUrl),
    endpoint: input.endpoint,
    armedAt: Date.now(),
    remaining: 1,
    description:
      input.description ??
      `${describeFaultKind(input.kind)} armed for ${describeFaultEndpoint(input.endpoint)} on ${normalizeUrl(
        input.mintUrl,
      )}.`,
  };

  faults.set(descriptor.id, descriptor);
  emitChange();

  return descriptor;
}

export function clearFaults(mintUrl?: string): void {
  if (!mintUrl) {
    if (faults.size === 0) {
      return;
    }

    faults.clear();
    emitChange();
    return;
  }

  const normalizedMintUrl = normalizeUrl(mintUrl);
  const matchingIds = [...faults.values()]
    .filter((fault) => normalizeUrl(fault.mintUrl) === normalizedMintUrl)
    .map((fault) => fault.id);

  if (matchingIds.length === 0) {
    return;
  }

  for (const id of matchingIds) {
    faults.delete(id);
  }

  emitChange();
}

export function getFaultsSnapshot(): FaultDescriptor[] {
  return faultsSnapshot;
}

export function subscribeToFaults(listener: Listener): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function installFaultInjection(manager: Manager): void {
  const managerWithPrivateRequestProvider = manager as unknown as ManagerWithPrivateRequestProvider;
  const requestProvider = managerWithPrivateRequestProvider.mintRequestProvider;

  if (!requestProvider || instrumentedManagers.has(manager)) {
    return;
  }

  const originalGetRequestFn = requestProvider.getRequestFn.bind(requestProvider);

  requestProvider.getRequestFn = (mintUrl: string) => {
    const requestFn = originalGetRequestFn(mintUrl);

    return async function wrappedRequestFn<T = unknown>(args: RequestOptions): Promise<T> {
      const endpoint = getFaultEndpoint(args.endpoint);
      const matchingFault = findMatchingFault(mintUrl, endpoint);

      if (!matchingFault) {
        return requestFn<T>(args);
      }

      if (matchingFault.kind === "network_failure") {
        consumeFault(matchingFault.id);
        return applyFault(matchingFault, null) as T;
      }

      const response = await requestFn<T>(args);
      consumeFault(matchingFault.id);
      return applyFault(matchingFault, response) as T;
    };
  };

  instrumentedManagers.add(manager);
}
