import { createWalletMnemonic, normalizeMnemonic, validateWalletMnemonic } from "./seed";
import { parsePassphrase } from "../lib/validation";

const VAULT_STORAGE_KEY = "cocolet:vault:v1";
const PBKDF2_ITERATIONS = 310_000;
const PBKDF2_HASH = "SHA-256";
const AES_MODE = "AES-GCM";
const SALT_BYTES = 16;
const IV_BYTES = 12;

type VaultEnvelope = {
  version: 1;
  salt: string;
  iv: string;
  ciphertext: string;
  createdAt: number;
  updatedAt: number;
};

let unlockedMnemonic: string | null = null;

function ensureCrypto(): Crypto {
  if (!window.crypto?.subtle) {
    throw new Error("Web Crypto is unavailable. Open the wallet in a modern secure browser context.");
  }

  return window.crypto;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";

  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }

  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function readVault(): VaultEnvelope | null {
  const raw = localStorage.getItem(VAULT_STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as VaultEnvelope;
    if (parsed.version !== 1) {
      throw new Error("Unsupported vault version.");
    }

    return parsed;
  } catch {
    throw new Error("The local wallet vault is corrupted.");
  }
}

function persistVault(vault: VaultEnvelope): void {
  localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(vault));
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const crypto = ensureCrypto();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: PBKDF2_HASH,
      iterations: PBKDF2_ITERATIONS,
      salt: toArrayBuffer(salt),
    },
    baseKey,
    { name: AES_MODE, length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptMnemonic(mnemonic: string, passphrase: string, createdAt = Date.now()): Promise<VaultEnvelope> {
  const crypto = ensureCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: AES_MODE, iv: toArrayBuffer(iv) },
    key,
    new TextEncoder().encode(mnemonic),
  );

  return {
    version: 1,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    createdAt,
    updatedAt: Date.now(),
  };
}

async function decryptVault(vault: VaultEnvelope, passphrase: string): Promise<string> {
  try {
    const key = await deriveKey(passphrase, base64ToBytes(vault.salt));
    const plaintext = await ensureCrypto().subtle.decrypt(
      { name: AES_MODE, iv: toArrayBuffer(base64ToBytes(vault.iv)) },
      key,
      toArrayBuffer(base64ToBytes(vault.ciphertext)),
    );
    const mnemonic = normalizeMnemonic(new TextDecoder().decode(plaintext));

    if (!validateWalletMnemonic(mnemonic)) {
      throw new Error("The decrypted vault data is invalid.");
    }

    return mnemonic;
  } catch {
    throw new Error("Incorrect passphrase or unreadable vault.");
  }
}

export function hasStoredVault(): boolean {
  return readVault() !== null;
}

export function getUnlockedMnemonic(): string | null {
  return unlockedMnemonic;
}

export function lockVault(): void {
  unlockedMnemonic = null;
}

export function clearVault(): void {
  lockVault();
  localStorage.removeItem(VAULT_STORAGE_KEY);
}

export async function createVault(passphrase: string, mnemonic = createWalletMnemonic()): Promise<string> {
  const normalizedPassphrase = parsePassphrase(passphrase);
  const normalizedMnemonic = normalizeMnemonic(mnemonic);

  if (!validateWalletMnemonic(normalizedMnemonic)) {
    throw new Error("Unable to create a vault with an invalid mnemonic.");
  }

  const vault = await encryptMnemonic(normalizedMnemonic, normalizedPassphrase);
  persistVault(vault);
  unlockedMnemonic = normalizedMnemonic;
  return normalizedMnemonic;
}

export async function unlockVault(passphrase: string): Promise<string> {
  const vault = readVault();

  if (!vault) {
    throw new Error("No encrypted wallet vault exists yet.");
  }

  const mnemonic = await decryptVault(vault, parsePassphrase(passphrase));
  unlockedMnemonic = mnemonic;
  return mnemonic;
}

export async function changeVaultPassphrase(currentPassphrase: string, nextPassphrase: string): Promise<void> {
  const vault = readVault();

  if (!vault) {
    throw new Error("No encrypted wallet vault exists yet.");
  }

  const mnemonic = await decryptVault(vault, parsePassphrase(currentPassphrase));
  const next = parsePassphrase(nextPassphrase);
  const nextVault = await encryptMnemonic(mnemonic, next, vault.createdAt);
  persistVault(nextVault);
  unlockedMnemonic = mnemonic;
}

export async function replaceVault(nextPassphrase: string, mnemonic: string): Promise<string> {
  const normalizedPassphrase = parsePassphrase(nextPassphrase);
  const normalizedMnemonic = normalizeMnemonic(mnemonic);

  if (!validateWalletMnemonic(normalizedMnemonic)) {
    throw new Error("Enter a valid replacement mnemonic.");
  }

  const nextVault = await encryptMnemonic(normalizedMnemonic, normalizedPassphrase);
  persistVault(nextVault);
  unlockedMnemonic = normalizedMnemonic;
  return normalizedMnemonic;
}
