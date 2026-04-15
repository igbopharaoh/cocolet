import { useEffect, useMemo, useState } from "react";
import { normalizeMintUrl, type Mint } from "@cashu/coco-core";
import { z } from "zod";
import { toErrorMessage } from "../lib/errors";

const DISCOVER_MINTS_URL = "https://api.audit.8333.space/mints";

const mintRecommendationSchema = z.object({
  id: z.number(),
  url: z.string().min(1),
  info: z.string().catch(""),
  name: z.string().catch(""),
  balance: z.number().catch(0),
  sum_donations: z.number().catch(0),
  updated_at: z.string().catch(""),
  next_update: z.string().catch(""),
  state: z.string().catch("unknown"),
  n_errors: z.number().catch(0),
  n_mints: z.number().catch(0),
  n_melts: z.number().catch(0),
});

const mintRecommendationsSchema = z.array(mintRecommendationSchema);

export type MintRecommendation = z.infer<typeof mintRecommendationSchema> & {
  normalizedUrl: string;
  directoryScore: number;
  parsedInfo: {
    raw: unknown;
    pubkey: string | null;
    entries: Array<{
      path: string;
      value: string;
    }>;
  };
};

export type UseDiscoverMintsResult = {
  recommendations: MintRecommendation[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

function isValidRecommendationUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function parseInfoValue(input: string): unknown {
  let current: unknown = input;

  for (let attempts = 0; attempts < 2; attempts += 1) {
    if (typeof current !== "string") {
      break;
    }

    const trimmed = current.trim();

    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      break;
    }

    try {
      current = JSON.parse(trimmed);
    } catch {
      break;
    }
  }

  return current;
}

function extractPubkey(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const entries = Object.entries(value as Record<string, unknown>);

  for (const [key, nestedValue] of entries) {
    const normalizedKey = key.toLowerCase();

    if (
      normalizedKey === "pubkey" ||
      normalizedKey === "publickey" ||
      normalizedKey === "public_key" ||
      normalizedKey === "pub_key"
    ) {
      return typeof nestedValue === "string" ? nestedValue : JSON.stringify(nestedValue);
    }
  }

  for (const [, nestedValue] of entries) {
    const nestedPubkey = extractPubkey(nestedValue);

    if (nestedPubkey) {
      return nestedPubkey;
    }
  }

  return null;
}

function flattenInfoEntries(value: unknown, prefix = ""): Array<{ path: string; value: string }> {
  if (value === null || value === undefined) {
    return [{ path: prefix || "value", value: String(value) }];
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [{ path: prefix || "value", value: String(value) }];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      flattenInfoEntries(item, prefix ? `${prefix}[${index}]` : `[${index}]`),
    );
  }

  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, nestedValue]) =>
      flattenInfoEntries(nestedValue, prefix ? `${prefix}.${key}` : key),
    );
  }

  return [{ path: prefix || "value", value: String(value) }];
}

function buildParsedInfo(info: string): MintRecommendation["parsedInfo"] {
  const raw = parseInfoValue(info);

  return {
    raw,
    pubkey: extractPubkey(raw),
    entries: flattenInfoEntries(raw),
  };
}

export function useDiscoverMints(mints: Mint[]): UseDiscoverMintsResult {
  const [allRecommendations, setAllRecommendations] = useState<MintRecommendation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    setIsLoading(true);

    try {
      const response = await fetch(DISCOVER_MINTS_URL, {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Mint directory request failed with ${response.status}.`);
      }

      const payload = mintRecommendationsSchema.parse(await response.json());
      const deduped = new Map<string, MintRecommendation>();

      for (const recommendation of payload) {
        if (!isValidRecommendationUrl(recommendation.url)) {
          continue;
        }

        const normalizedUrl = normalizeMintUrl(recommendation.url);

        if (!deduped.has(normalizedUrl)) {
          deduped.set(normalizedUrl, {
            ...recommendation,
            normalizedUrl,
            directoryScore: recommendation.sum_donations,
            parsedInfo: buildParsedInfo(recommendation.info),
          });
        }
      }

      setAllRecommendations([...deduped.values()]);
      setError(null);
    } catch (nextError) {
      setError(toErrorMessage(nextError));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const recommendations = useMemo(() => {
    const trustedMintUrls = new Set(
      mints.filter((mint) => mint.trusted).map((mint) => normalizeMintUrl(mint.mintUrl)),
    );

    return allRecommendations
      .filter((recommendation) => !trustedMintUrls.has(recommendation.normalizedUrl))
      .sort((left, right) => {
        if (left.directoryScore !== right.directoryScore) {
          return right.directoryScore - left.directoryScore;
        }

        if (left.n_errors !== right.n_errors) {
          return left.n_errors - right.n_errors;
        }

        const leftActivity = left.n_mints + left.n_melts;
        const rightActivity = right.n_mints + right.n_melts;
        return rightActivity - leftActivity;
      });
  }, [allRecommendations, mints]);

  return {
    recommendations,
    isLoading,
    error,
    refresh,
  };
}
