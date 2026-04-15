import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

export function normalizeMnemonic(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

export function createWalletMnemonic(): string {
  return generateMnemonic(wordlist, 128);
}

export function validateWalletMnemonic(input: string): boolean {
  const mnemonic = normalizeMnemonic(input);
  return validateMnemonic(mnemonic, wordlist);
}

export function mnemonicToSeedBytes(input: string): Uint8Array {
  const mnemonic = normalizeMnemonic(input);
  return mnemonicToSeedSync(mnemonic);
}
