import { normalizeMintUrl } from "@cashu/coco-core";
import { z } from "zod";
import { normalizeMnemonic, validateWalletMnemonic } from "../coco/seed";

const amountSchema = z.number().int().positive();

export function parseAmount(input: string, label = "Amount"): number {
  const parsed = Number(input);
  const result = amountSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(`${label} must be a whole number greater than zero.`);
  }

  return result.data;
}

export function parseMintUrl(input: string): string {
  let parsed: URL;

  try {
    parsed = new URL(input.trim());
  } catch {
    throw new Error("Enter a valid mint URL.");
  }

  const isLocalhost =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "::1";

  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocalhost)) {
    throw new Error("Only HTTPS mint URLs are allowed, except for localhost during development.");
  }

  return normalizeMintUrl(parsed.toString());
}

export function parsePassphrase(input: string): string {
  const value = input.trim();

  if (value.length < 12) {
    throw new Error("Use a passphrase that is at least 12 characters long.");
  }

  return value;
}

export function parseMnemonic(input: string): string {
  const mnemonic = normalizeMnemonic(input);

  if (!validateWalletMnemonic(mnemonic)) {
    throw new Error("Enter a valid BIP-39 mnemonic.");
  }

  return mnemonic;
}

export function normalizeLightningRequest(input: string): string {
  const trimmed = input.trim().replace(/\s+/g, "");
  const lightningPrefix = /^lightning:/i;
  const normalized = lightningPrefix.test(trimmed)
    ? trimmed.replace(lightningPrefix, "")
    : trimmed;

  if (!/^ln/i.test(normalized)) {
    throw new Error("Enter a valid BOLT11 invoice.");
  }

  return normalized;
}

export function normalizeTokenInput(input: string): string {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new Error("Paste a Cashu token.");
  }

  return trimmed;
}
