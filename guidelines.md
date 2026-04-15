# Coco Web Wallet — Step-by-Step Implementation Guide

> Target: Complete a browser-based Cashu PoC wallet in one day using `@cashu/coco-core`,
> `@cashu/coco-indexeddb`, fully exercising the saga APIs (mint, melt, send, receive).
> No deprecated APIs. All code examples match the current coco v1 RC surface.

---

## Prerequisites & Reading

Before writing a single line of code, open these tabs:

- Core README: https://github.com/cashubtc/coco/blob/master/packages/core/README.md
- Send saga docs: https://cashubtc.github.io/coco/pages/send-operations.html
- Melt saga docs: https://cashubtc.github.io/coco/pages/melt-operations.html
- Mint saga docs: https://cashubtc.github.io/coco/starting/minting.html
- Sending and receiving: https://cashubtc.github.io/coco/starting/sending-receiving.html

---

## Phase 0 — Project Scaffold (30 min)

### 0.1 Create the Vite + React + TypeScript project

```bash
npm create vite@latest coco-web-wallet -- --template react-ts
cd coco-web-wallet
```

### 0.2 Install dependencies

```bash
# Core Cashu/coco packages
npm install @cashu/coco-core @cashu/coco-indexeddb

# BIP39 seed generation (needed for seedGetter)
npm install @scure/bip39 @scure/bip32

# QR code generation + scanning
npm install qrcode react-qr-scanner
npm install -D @types/qrcode

# UI utilities
npm install clsx lucide-react
```

### 0.3 Project structure

```
src/
  coco/
    manager.ts          # initializeCoco singleton + seedGetter
    seed.ts             # mnemonic storage / generation
  hooks/
    useCoco.ts          # global manager context hook
    useBalances.ts      # reactive balance hook
    useHistory.ts       # reactive history hook
    useMints.ts         # reactive mint list hook
  components/
    MintManager.tsx     # add/trust/remove mints
    MintFlow.tsx        # Lightning → ecash (mint saga)
    MeltFlow.tsx        # ecash → Lightning (melt saga)
    SendFlow.tsx        # ecash token send saga
    ReceiveFlow.tsx     # ecash token receive
    DebugPanel.tsx      # state machine + event log
    AdversarialPanel.tsx# testing toggles
  App.tsx
  main.tsx
```

---

## Phase 1 — Wallet Initialization (45 min)

### 1.1 Seed management (`src/coco/seed.ts`)

The wallet needs a deterministic BIP-39 seed. For the PoC, store the mnemonic in
`localStorage` (not production-safe, but sufficient). Never store the raw seed bytes.

```typescript
import { generateMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

const MNEMONIC_KEY = "coco_wallet_mnemonic";

export function getOrCreateMnemonic(): string {
  let mnemonic = localStorage.getItem(MNEMONIC_KEY);
  if (!mnemonic) {
    mnemonic = generateMnemonic(wordlist, 128); // 12 words
    localStorage.setItem(MNEMONIC_KEY, mnemonic);
  }
  return mnemonic;
}

export function exportMnemonic(): string {
  return localStorage.getItem(MNEMONIC_KEY) ?? "";
}

export function importMnemonic(mnemonic: string): void {
  localStorage.setItem(MNEMONIC_KEY, mnemonic);
  window.location.reload();
}

export function wipeMnemonic(): void {
  localStorage.removeItem(MNEMONIC_KEY);
}

// Used by initializeCoco as the seedGetter
export async function seedGetter(): Promise<Uint8Array> {
  const mnemonic = getOrCreateMnemonic();
  return mnemonicToSeedSync(mnemonic);
}
```

### 1.2 Manager singleton (`src/coco/manager.ts`)

```typescript
import { initializeCoco } from "@cashu/coco-core";
import { IndexedDbRepositories } from "@cashu/coco-indexeddb";
import { ConsoleLogger } from "@cashu/coco-core";
import { seedGetter } from "./seed";

let managerPromise: ReturnType<typeof initializeCoco> | null = null;

export function getManager() {
  if (!managerPromise) {
    const repo = new IndexedDbRepositories({ name: "coco-web-wallet" });
    const logger = new ConsoleLogger("coco-wallet", { level: "debug" });

    managerPromise = initializeCoco({
      repo,
      seedGetter,
      logger,
      // Watchers are enabled by default — explicit for clarity:
      watchers: {
        mintOperationWatcher: true,
        proofStateWatcher: true,
      },
      processors: {
        mintOperationProcessor: true,
        mintOperationProcessorIntervalMs: 3000,
      },
    });
  }
  return managerPromise;
}
```

### 1.3 React context (`src/hooks/useCoco.ts`)

Wrap the manager promise in a React context so every component can access it.

```typescript
import { createContext, useContext, useEffect, useState } from 'react';
import { getManager } from '../coco/manager';
import type { Manager } from '@cashu/coco-core';

const CocoContext = createContext<Manager | null>(null);

export function CocoProvider({ children }: { children: React.ReactNode }) {
  const [manager, setManager] = useState<Manager | null>(null);

  useEffect(() => {
    getManager().then(setManager);
  }, []);

  if (!manager) return <div>Initializing wallet…</div>;

  return <CocoContext.Provider value={manager}>{children}</CocoContext.Provider>;
}

export function useCoco(): Manager {
  const ctx = useContext(CocoContext);
  if (!ctx) throw new Error('useCoco used outside CocoProvider');
  return ctx;
}
```

Wire it in `main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CocoProvider } from "./hooks/useCoco";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CocoProvider>
      <App />
    </CocoProvider>
  </StrictMode>,
);
```

---

## Phase 2 — Reactive Hooks (30 min)

### 2.1 Balances (`src/hooks/useBalances.ts`)

```typescript
import { useEffect, useState, useCallback } from "react";
import { useCoco } from "./useCoco";
import type { BalancesByMint } from "@cashu/coco-core";

export function useBalances() {
  const coco = useCoco();
  const [balances, setBalances] = useState<BalancesByMint>({});
  const [total, setTotal] = useState(0);

  const refresh = useCallback(async () => {
    const [b, t] = await Promise.all([coco.wallet.balances.byMint(), coco.wallet.balances.total()]);
    setBalances(b);
    setTotal(t.total);
  }, [coco]);

  useEffect(() => {
    refresh();

    // Re-sync on any proof event
    const off = [
      coco.on("proofs:saved", refresh),
      coco.on("proofs:state-changed", refresh),
      coco.on("proofs:deleted", refresh),
      coco.on("mint-op:finalized", refresh),
      coco.on("melt-op:finalized", refresh),
      coco.on("send:finalized", refresh),
      coco.on("receive-op:finalized", refresh),
    ];
    return () => off.forEach((fn) => fn());
  }, [coco, refresh]);

  return { balances, total, refresh };
}
```

### 2.2 Mints (`src/hooks/useMints.ts`)

```typescript
import { useEffect, useState, useCallback } from "react";
import { useCoco } from "./useCoco";
import type { Mint } from "@cashu/coco-core";

export function useMints() {
  const coco = useCoco();
  const [mints, setMints] = useState<Mint[]>([]);

  const refresh = useCallback(async () => {
    const all = await coco.mint.getAllMints();
    setMints(all);
  }, [coco]);

  useEffect(() => {
    refresh();
    const off = [coco.on("mint:added", refresh), coco.on("mint:trusted", refresh), coco.on("mint:untrusted", refresh)];
    return () => off.forEach((fn) => fn());
  }, [coco, refresh]);

  return { mints, refresh };
}
```

### 2.3 History (`src/hooks/useHistory.ts`)

```typescript
import { useEffect, useState, useCallback } from "react";
import { useCoco } from "./useCoco";
import type { HistoryEntry } from "@cashu/coco-core";

export function useHistory() {
  const coco = useCoco();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  const refresh = useCallback(async () => {
    const h = await coco.history.getPaginatedHistory(0, 50);
    setEntries(h);
  }, [coco]);

  useEffect(() => {
    refresh();
    const off = coco.on("history:updated", refresh);
    return () => off();
  }, [coco, refresh]);

  return { entries, refresh };
}
```

---

## Phase 3 — Mint Management UI (30 min)

### 3.1 `MintManager.tsx`

```tsx
import { useState } from "react";
import { useCoco } from "../hooks/useCoco";
import { useMints } from "../hooks/useMints";
import { useBalances } from "../hooks/useBalances";

export function MintManager() {
  const coco = useCoco();
  const { mints } = useMints();
  const { balances } = useBalances();
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");

  async function handleAdd() {
    if (!url.trim()) return;
    try {
      setStatus("Adding…");
      await coco.mint.addMint(url.trim(), { trusted: true });
      setUrl("");
      setStatus("Mint added and trusted ✓");
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  }

  async function toggleTrust(mintUrl: string, isTrusted: boolean) {
    if (isTrusted) {
      await coco.mint.untrustMint(mintUrl);
    } else {
      await coco.mint.trustMint(mintUrl);
    }
  }

  return (
    <section>
      <h2>Mints</h2>
      <div>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder='https://mint.example.com' />
        <button onClick={handleAdd}>Add & Trust</button>
        {status && <p>{status}</p>}
      </div>

      {mints.map((mint) => {
        const bal = balances[mint.url];
        return (
          <div key={mint.url}>
            <span>{mint.url}</span>
            <span>Spendable: {bal?.spendable ?? 0} sats</span>
            <span>Reserved: {bal?.reserved ?? 0} sats</span>
            <span>Trusted: {mint.trusted ? "✓" : "✗"}</span>
            <button onClick={() => toggleTrust(mint.url, !!mint.trusted)}>{mint.trusted ? "Untrust" : "Trust"}</button>
          </div>
        );
      })}
    </section>
  );
}
```

---

## Phase 4 — Mint Flow / Lightning → Ecash Saga (45 min)

The mint saga uses `coco.ops.mint`. After `prepare()`, the watcher auto-executes
once the invoice is paid. You can also listen for `mint-op:finalized`.

### 4.1 `MintFlow.tsx`

```tsx
import { useState } from "react";
import { useCoco } from "../hooks/useCoco";
import { useMints } from "../hooks/useMints";
import QRCode from "qrcode";
import { useEffect, useRef } from "react";

export function MintFlow() {
  const coco = useCoco();
  const { mints } = useMints();
  const [mintUrl, setMintUrl] = useState("");
  const [amount, setAmount] = useState("");
  const [invoice, setInvoice] = useState("");
  const [operationId, setOperationId] = useState("");
  const [status, setStatus] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Listen for automatic finalization by the watcher
  useEffect(() => {
    if (!operationId) return;
    const off = coco.on("mint-op:finalized", (payload) => {
      if (payload.operationId === operationId) {
        setStatus("✅ Minted! Proofs are in your wallet.");
        setInvoice("");
      }
    });
    return () => off();
  }, [coco, operationId]);

  async function handlePrepare() {
    if (!mintUrl || !amount) return;
    try {
      setStatus("Creating quote…");

      // SAGA STEP 1: prepare() — creates the remote mint quote + stores operation
      const pending = await coco.ops.mint.prepare({
        mintUrl,
        amount: parseInt(amount, 10),
        method: "bolt11",
        methodData: {},
      });

      setInvoice(pending.request);
      setOperationId(pending.id);
      setStatus(`Pay this invoice. Quote ID: ${pending.quoteId}`);

      // Generate QR
      const dataUrl = await QRCode.toDataURL(pending.request.toUpperCase());
      setQrDataUrl(dataUrl);
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  }

  // Manual execute (if user wants to trigger without waiting for watcher)
  async function handleExecute() {
    try {
      setStatus("Executing…");
      await coco.ops.mint.execute(operationId);
      setStatus("✅ Minted successfully!");
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  }

  return (
    <section>
      <h2>Mint (Lightning → Ecash)</h2>

      <select value={mintUrl} onChange={(e) => setMintUrl(e.target.value)}>
        <option value=''>Select mint…</option>
        {mints
          .filter((m) => m.trusted)
          .map((m) => (
            <option key={m.url} value={m.url}>
              {m.url}
            </option>
          ))}
      </select>

      <input type='number' value={amount} onChange={(e) => setAmount(e.target.value)} placeholder='Amount in sats' />

      <button onClick={handlePrepare}>Generate Invoice</button>

      {invoice && (
        <div>
          {qrDataUrl && <img src={qrDataUrl} alt='Invoice QR' />}
          <textarea readOnly value={invoice} rows={4} />
          <button onClick={() => navigator.clipboard.writeText(invoice)}>Copy Invoice</button>
          <button onClick={handleExecute}>Force Redeem (after payment)</button>
        </div>
      )}

      {status && <p>{status}</p>}
    </section>
  );
}
```

**Key coco APIs used:**

- `coco.ops.mint.prepare({ mintUrl, amount, method, methodData })` — creates quote + stores op
- `coco.ops.mint.execute(operationId)` — claims ecash after payment
- `coco.on('mint-op:finalized', cb)` — auto-finalization event from watcher

---

## Phase 5 — Melt Flow / Ecash → Lightning Saga (45 min)

The melt saga is the most critical for fund safety. Always `prepare()` first to
show fees, then `execute()` only after user confirms.

### 5.1 `MeltFlow.tsx`

```tsx
import { useState } from "react";
import { useCoco } from "../hooks/useCoco";
import { useMints } from "../hooks/useMints";

type MeltStep = "form" | "confirm" | "executing" | "done";

export function MeltFlow() {
  const coco = useCoco();
  const { mints } = useMints();
  const [mintUrl, setMintUrl] = useState("");
  const [invoice, setInvoice] = useState("");
  const [step, setStep] = useState<MeltStep>("form");
  const [prepared, setPrepared] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [status, setStatus] = useState("");

  // SAGA STEP 1: prepare — creates quote, reserves proofs, calculates fees
  async function handlePrepare() {
    if (!mintUrl || !invoice.trim()) return;
    try {
      setStatus("Preparing melt…");
      const prep = await coco.ops.melt.prepare({
        mintUrl,
        method: "bolt11",
        methodData: { invoice: invoice.trim() },
      });
      setPrepared(prep);
      setStep("confirm");
      setStatus("");
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  }

  // SAGA STEP 2: execute — contacts mint, pays invoice
  async function handleExecute() {
    if (!prepared) return;
    try {
      setStep("executing");
      setStatus("Sending payment…");
      const res = await coco.ops.melt.execute(prepared.id);

      if (res.state === "finalized") {
        setResult(res);
        setStatus("✅ Payment sent!");
        setStep("done");
      } else if (res.state === "pending") {
        setStatus("⏳ Payment pending — checking…");
        pollMelt(prepared.id);
      }
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
      setStep("confirm");
    }
  }

  // Poll pending melt until finalized
  async function pollMelt(operationId: string) {
    const interval = setInterval(async () => {
      try {
        const op = await coco.ops.melt.refresh(operationId);
        if (op.state === "finalized") {
          clearInterval(interval);
          setResult(op);
          setStep("done");
          setStatus("✅ Payment confirmed!");
        } else if (op.state === "rolled_back") {
          clearInterval(interval);
          setStep("form");
          setStatus("Payment rolled back — proofs returned.");
        }
      } catch {
        /* continue polling */
      }
    }, 3000);
  }

  // Cancel from confirm step — releases reserved proofs
  async function handleCancel() {
    if (!prepared) return;
    await coco.ops.melt.cancel(prepared.id);
    setPrepared(null);
    setStep("form");
    setStatus("Cancelled — proofs released.");
  }

  return (
    <section>
      <h2>Melt (Ecash → Lightning)</h2>

      {step === "form" && (
        <>
          <select value={mintUrl} onChange={(e) => setMintUrl(e.target.value)}>
            <option value=''>Select mint…</option>
            {mints
              .filter((m) => m.trusted)
              .map((m) => (
                <option key={m.url} value={m.url}>
                  {m.url}
                </option>
              ))}
          </select>

          <textarea value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder='Paste BOLT11 invoice…' rows={4} />

          <button onClick={handlePrepare}>Get Fee Quote</button>
        </>
      )}

      {step === "confirm" && prepared && (
        <div>
          <h3>Confirm Payment</h3>
          <p>Amount: {prepared.amount} sats</p>
          <p>Fee reserve: {prepared.fee_reserve} sats</p>
          <p>Swap fee: {prepared.swap_fee ?? 0} sats</p>
          <p>Needs swap: {prepared.needsSwap ? "Yes" : "No"}</p>
          <button onClick={handleExecute}>Confirm & Pay</button>
          <button onClick={handleCancel}>Cancel</button>
        </div>
      )}

      {step === "executing" && <p>⏳ Contacting mint…</p>}

      {step === "done" && result && (
        <div>
          <p>✅ Paid!</p>
          <p>Change returned: {result.changeAmount ?? 0} sats</p>
          <p>Effective fee: {result.effectiveFee ?? "n/a"} sats</p>
          <button
            onClick={() => {
              setStep("form");
              setInvoice("");
              setPrepared(null);
            }}
          >
            New Payment
          </button>
        </div>
      )}

      {status && <p>{status}</p>}
    </section>
  );
}
```

**Key coco APIs used:**

- `coco.ops.melt.prepare({ mintUrl, method, methodData: { invoice } })` — quote + reserve
- `coco.ops.melt.execute(operationId)` — pays invoice
- `coco.ops.melt.refresh(operationId)` — polls pending state
- `coco.ops.melt.cancel(operationId)` — releases proofs if user cancels

---

## Phase 6 — Send Flow / Token Send Saga (45 min)

### 6.1 `SendFlow.tsx`

```tsx
import { useState, useEffect } from "react";
import { useCoco } from "../hooks/useCoco";
import { useMints } from "../hooks/useMints";
import QRCode from "qrcode";

type SendStep = "form" | "confirm" | "pending" | "done";

export function SendFlow() {
  const coco = useCoco();
  const { mints } = useMints();
  const [mintUrl, setMintUrl] = useState("");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<SendStep>("form");
  const [prepared, setPrepared] = useState<any>(null);
  const [token, setToken] = useState("");
  const [operationId, setOperationId] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [status, setStatus] = useState("");

  // Listen for automatic finalization (recipient claimed)
  useEffect(() => {
    if (!operationId) return;
    const off = coco.on("send:finalized", (payload) => {
      if (payload.operationId === operationId) {
        setStep("done");
        setStatus("✅ Token claimed by recipient!");
      }
    });
    return () => off();
  }, [coco, operationId]);

  // SAGA STEP 1: prepare — reserve proofs, calculate fee
  async function handlePrepare() {
    if (!mintUrl || !amount) return;
    try {
      setStatus("Preparing…");
      const prep = await coco.ops.send.prepare({
        mintUrl,
        amount: parseInt(amount, 10),
      });
      setPrepared(prep);
      setStep("confirm");
      setStatus("");
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  }

  // SAGA STEP 2: execute — create the sendable token string
  async function handleExecute() {
    if (!prepared) return;
    try {
      setStatus("Creating token…");
      const { operation, token: t } = await coco.ops.send.execute(prepared.id);
      setToken(t);
      setOperationId(operation.id);
      setStep("pending");
      setStatus("Share this token with the recipient.");

      const dataUrl = await QRCode.toDataURL(t);
      setQrDataUrl(dataUrl);
    } catch (e: any) {
      // If execute fails, cancel to release proofs
      await coco.ops.send.cancel(prepared.id).catch(() => {});
      setStatus(`Error: ${e.message}`);
      setStep("form");
    }
  }

  async function handleCancel() {
    if (!prepared) return;
    await coco.ops.send.cancel(prepared.id);
    setPrepared(null);
    setStep("form");
    setStatus("Cancelled — proofs released.");
  }

  // Reclaim if recipient never claimed
  async function handleReclaim() {
    if (!operationId) return;
    try {
      setStatus("Reclaiming…");
      await coco.ops.send.reclaim(operationId);
      setStep("form");
      setStatus("Proofs reclaimed (minus swap fee).");
    } catch (e: any) {
      setStatus(`Reclaim failed: ${e.message}`);
    }
  }

  return (
    <section>
      <h2>Send Token</h2>

      {step === "form" && (
        <>
          <select value={mintUrl} onChange={(e) => setMintUrl(e.target.value)}>
            <option value=''>Select mint…</option>
            {mints
              .filter((m) => m.trusted)
              .map((m) => (
                <option key={m.url} value={m.url}>
                  {m.url}
                </option>
              ))}
          </select>
          <input type='number' value={amount} onChange={(e) => setAmount(e.target.value)} placeholder='Amount in sats' />
          <button onClick={handlePrepare}>Prepare Send</button>
        </>
      )}

      {step === "confirm" && prepared && (
        <div>
          <h3>Confirm Send</h3>
          <p>Amount: {prepared.amount} sats</p>
          <p>Fee: {prepared.fee ?? 0} sats</p>
          <p>Needs swap: {prepared.needsSwap ? "Yes" : "No"}</p>
          <p>Total input: {prepared.inputAmount} sats</p>
          <button onClick={handleExecute}>Confirm & Create Token</button>
          <button onClick={handleCancel}>Cancel</button>
        </div>
      )}

      {step === "pending" && (
        <div>
          {qrDataUrl && <img src={qrDataUrl} alt='Token QR' />}
          <textarea readOnly value={token} rows={6} />
          <button onClick={() => navigator.clipboard.writeText(token)}>Copy Token</button>
          <button onClick={handleReclaim}>Reclaim (recipient didn't claim)</button>
          <p>{status}</p>
        </div>
      )}

      {step === "done" && <p>{status}</p>}

      {step !== "pending" && status && <p>{status}</p>}
    </section>
  );
}
```

**Key coco APIs used:**

- `coco.ops.send.prepare({ mintUrl, amount })` — reserve + fee calc
- `coco.ops.send.execute(operationId)` — returns `{ operation, token }`
- `coco.ops.send.cancel(operationId)` — releases proofs
- `coco.ops.send.reclaim(operationId)` — reclaims unclaimed token
- `coco.on('send:finalized', cb)` — recipient claimed event

---

## Phase 7 — Receive Flow (30 min)

### 7.1 `ReceiveFlow.tsx`

```tsx
import { useState } from "react";
import { useCoco } from "../hooks/useCoco";

export function ReceiveFlow() {
  const coco = useCoco();
  const [tokenStr, setTokenStr] = useState("");
  const [status, setStatus] = useState("");
  const [decoded, setDecoded] = useState<any>(null);

  // Decode first to show what the token contains before claiming
  async function handleDecode() {
    try {
      const t = await coco.wallet.decodeToken(tokenStr.trim());
      setDecoded(t);
      setStatus("Token decoded — review and claim below.");
    } catch (e: any) {
      setStatus(`Invalid token: ${e.message}`);
    }
  }

  // coco.wallet.receive is the canonical receive path — uses ops.receive internally
  async function handleReceive() {
    try {
      setStatus("Receiving…");
      await coco.wallet.receive(tokenStr.trim());
      setStatus("✅ Proofs saved to wallet!");
      setTokenStr("");
      setDecoded(null);
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  }

  return (
    <section>
      <h2>Receive Token</h2>

      <textarea value={tokenStr} onChange={(e) => setTokenStr(e.target.value)} placeholder='Paste cashuB… or cashuA… token' rows={5} />

      <button onClick={handleDecode} disabled={!tokenStr.trim()}>
        Decode & Preview
      </button>

      {decoded && (
        <div>
          <p>Mint: {decoded.mint}</p>
          <p>Proofs: {decoded.proofs?.length ?? 0}</p>
          <p>Total: {decoded.proofs?.reduce((s: number, p: any) => s + p.amount, 0)} sats</p>
          <button onClick={handleReceive}>Claim Proofs</button>
        </div>
      )}

      {status && <p>{status}</p>}
    </section>
  );
}
```

**Key coco APIs used:**

- `coco.wallet.decodeToken(tokenString)` — parse without claiming
- `coco.wallet.receive(tokenString | Token)` — swap + claim proofs
- `coco.on('receive-op:finalized', cb)` — listen for completion

---

## Phase 8 — Debug Panel / Observability (45 min)

The debug panel is the adversarial testing heart of the PoC. It shows a live
event log, all proof states, and all in-flight operations.

### 8.1 `DebugPanel.tsx`

```tsx
import { useEffect, useState, useRef } from "react";
import { useCoco } from "../hooks/useCoco";
import { useHistory } from "../hooks/useHistory";

type LogEntry = { ts: string; event: string; payload: string };

const ALL_EVENTS = [
  "mint:added",
  "mint:trusted",
  "mint:untrusted",
  "proofs:saved",
  "proofs:state-changed",
  "proofs:reserved",
  "proofs:released",
  "proofs:deleted",
  "mint-op:pending",
  "mint-op:executing",
  "mint-op:finalized",
  "mint-op:quote-state-changed",
  "melt-op:prepared",
  "melt-op:pending",
  "melt-op:finalized",
  "melt-op:rolled-back",
  "send:prepared",
  "send:pending",
  "send:finalized",
  "send:rolled-back",
  "receive-op:prepared",
  "receive-op:finalized",
  "receive-op:rolled-back",
  "history:updated",
  "counter:updated",
] as const;

export function DebugPanel() {
  const coco = useCoco();
  const { entries } = useHistory();
  const [log, setLog] = useState<LogEntry[]>([]);
  const [pendingSends, setPendingSends] = useState<any[]>([]);
  const [pendingMelts, setPendingMelts] = useState<any[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  // Subscribe to every event
  useEffect(() => {
    const offs = ALL_EVENTS.map((event) =>
      (coco.on as any)(event, (payload: unknown) => {
        const entry: LogEntry = {
          ts: new Date().toISOString().slice(11, 23),
          event,
          payload: JSON.stringify(payload, null, 0).slice(0, 200),
        };
        setLog((prev) => [entry, ...prev].slice(0, 200));
      }),
    );
    return () => offs.forEach((fn) => fn());
  }, [coco]);

  // Auto-scroll
  useEffect(() => {
    logRef.current?.scrollTo(0, 0);
  }, [log]);

  async function refreshOps() {
    const [sends, melts] = await Promise.all([coco.ops.send.listInFlight(), coco.ops.melt.listInFlight()]);
    setPendingSends(sends);
    setPendingMelts(melts);
  }

  return (
    <section>
      <h2>Debug Panel</h2>
      <button onClick={refreshOps}>Refresh In-Flight Ops</button>

      <details open>
        <summary>In-Flight Send Operations ({pendingSends.length})</summary>
        <pre>{JSON.stringify(pendingSends, null, 2)}</pre>
      </details>

      <details>
        <summary>In-Flight Melt Operations ({pendingMelts.length})</summary>
        <pre>{JSON.stringify(pendingMelts, null, 2)}</pre>
      </details>

      <details open>
        <summary>Transaction History ({entries.length})</summary>
        {entries.map((e) => (
          <div key={e.id}>
            [{e.type}] {e.amount} sats — {e.state} — {new Date(e.createdAt).toLocaleString()}
          </div>
        ))}
      </details>

      <details open>
        <summary>Live Event Log</summary>
        <div ref={logRef} style={{ height: 300, overflowY: "auto", fontFamily: "monospace" }}>
          {log.map((l, i) => (
            <div key={i}>
              <span style={{ color: "#888" }}>{l.ts}</span> <strong>{l.event}</strong> <span>{l.payload}</span>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
```

---

## Phase 9 — Adversarial Testing Panel (45 min)

This panel exercises edge cases and lets you deliberately trigger fault conditions.

### 9.1 `AdversarialPanel.tsx`

```tsx
import { useState } from "react";
import { useCoco } from "../hooks/useCoco";
import { useMints } from "../hooks/useMints";

export function AdversarialPanel() {
  const coco = useCoco();
  const { mints } = useMints();
  const [mintUrl, setMintUrl] = useState("");
  const [status, setStatus] = useState("");
  const [corruptToken, setCorruptToken] = useState("");

  // --- TEST: Attempt double-spend ---
  // Prepare a send, get the token, then try to receive from the SAME token twice.
  async function testDoubleSpend() {
    if (!mintUrl) return setStatus("Select a mint first");
    try {
      setStatus("Preparing double-spend test…");

      // Prepare + execute a tiny send
      const prep = await coco.ops.send.prepare({ mintUrl, amount: 1 });
      const { token } = await coco.ops.send.execute(prep.id);

      setStatus("First receive…");
      await coco.wallet.receive(token); // should succeed

      setStatus("Second receive (double-spend attempt)…");
      await coco.wallet.receive(token); // should throw

      setStatus("❌ Double-spend was NOT detected!");
    } catch (e: any) {
      setStatus(`✅ Double-spend correctly rejected: ${e.message}`);
    }
  }

  // --- TEST: Corrupt token injection ---
  async function testCorruptToken() {
    const corrupt = "cashuBcorruptpayloadXXXXXXXXXXXXXXX";
    try {
      await coco.wallet.receive(corrupt);
      setStatus("❌ Corrupt token was not rejected!");
    } catch (e: any) {
      setStatus(`✅ Corrupt token rejected: ${e.message}`);
    }
  }

  // --- TEST: Custom corrupt token from textarea ---
  async function testCustomToken() {
    if (!corruptToken.trim()) return;
    try {
      await coco.wallet.receive(corruptToken.trim());
      setStatus("Token accepted (valid or undetected corruption)");
    } catch (e: any) {
      setStatus(`Token rejected: ${e.message}`);
    }
  }

  // --- TEST: Recover stale prepared sends ---
  async function testRecoverPreparedSends() {
    const prepared = await coco.ops.send.listPrepared();
    setStatus(`Found ${prepared.length} stale prepared sends.`);

    for (const op of prepared) {
      const age = Date.now() - op.createdAt;
      if (age > 60_000) {
        await coco.ops.send.cancel(op.id);
        setStatus(`Auto-cancelled stale send: ${op.id}`);
      }
    }
  }

  // --- TEST: Force mint operation recovery ---
  async function testMintRecovery() {
    try {
      await coco.ops.mint.recovery.run();
      setStatus("Mint recovery ran successfully.");
    } catch (e: any) {
      setStatus(`Recovery error: ${e.message}`);
    }
  }

  // --- TEST: Force melt operation recovery ---
  async function testMeltRecovery() {
    try {
      await coco.ops.melt.recovery.run();
      setStatus("Melt recovery ran successfully.");
    } catch (e: any) {
      setStatus(`Recovery error: ${e.message}`);
    }
  }

  // --- TEST: Wallet restore from seed ---
  async function testRestore() {
    if (!mintUrl) return setStatus("Select a mint first");
    try {
      setStatus("Restoring from seed…");
      await coco.wallet.restore(mintUrl);
      setStatus("Restore complete.");
    } catch (e: any) {
      setStatus(`Restore error: ${e.message}`);
    }
  }

  // --- TEST: Check pending sends and attempt reclaim ---
  async function testReclaimPending() {
    const ops = await coco.ops.send.listInFlight();
    const pending = ops.filter((o: any) => o.state === "pending");
    setStatus(`Found ${pending.length} pending sends.`);

    for (const op of pending) {
      try {
        await coco.ops.send.reclaim(op.id);
        setStatus(`Reclaimed op ${op.id}`);
      } catch (e: any) {
        setStatus(`Reclaim failed for ${op.id}: ${e.message}`);
      }
    }
  }

  // --- TEST: Mint diagnostics ---
  async function testDiagnostics() {
    try {
      const diag = await coco.ops.send.diagnostics();
      setStatus(JSON.stringify(diag, null, 2));
    } catch (e: any) {
      setStatus(`Diagnostics error: ${e.message}`);
    }
  }

  return (
    <section>
      <h2>🔴 Adversarial Testing Panel</h2>

      <select value={mintUrl} onChange={(e) => setMintUrl(e.target.value)}>
        <option value=''>Select mint for tests…</option>
        {mints
          .filter((m) => m.trusted)
          .map((m) => (
            <option key={m.url} value={m.url}>
              {m.url}
            </option>
          ))}
      </select>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "12px 0" }}>
        <button onClick={testDoubleSpend}>🔁 Double-Spend Test</button>
        <button onClick={testCorruptToken}>💣 Inject Corrupt Token</button>
        <button onClick={testRecoverPreparedSends}>🔄 Recover Stale Sends</button>
        <button onClick={testMintRecovery}>🏦 Run Mint Recovery</button>
        <button onClick={testMeltRecovery}>⚡ Run Melt Recovery</button>
        <button onClick={testRestore}>🌱 Wallet Restore</button>
        <button onClick={testReclaimPending}>♻️ Reclaim Pending Sends</button>
        <button onClick={testDiagnostics}>🔬 Send Diagnostics</button>
      </div>

      <div>
        <h4>Custom Token Injection</h4>
        <textarea
          value={corruptToken}
          onChange={(e) => setCorruptToken(e.target.value)}
          placeholder='Paste any token (valid, expired, tampered…)'
          rows={3}
        />
        <button onClick={testCustomToken}>Inject & Test</button>
      </div>

      {status && <pre style={{ background: "#111", color: "#0f0", padding: 12, marginTop: 12 }}>{status}</pre>}
    </section>
  );
}
```

---

## Phase 10 — App Shell & Wiring (20 min)

### 10.1 `App.tsx`

```tsx
import { useState } from "react";
import { MintManager } from "./components/MintManager";
import { MintFlow } from "./components/MintFlow";
import { MeltFlow } from "./components/MeltFlow";
import { SendFlow } from "./components/SendFlow";
import { ReceiveFlow } from "./components/ReceiveFlow";
import { DebugPanel } from "./components/DebugPanel";
import { AdversarialPanel } from "./components/AdversarialPanel";
import { useBalances } from "./hooks/useBalances";

type Tab = "mints" | "mint" | "melt" | "send" | "receive" | "debug" | "adversarial";

const TABS: { id: Tab; label: string }[] = [
  { id: "mints", label: "Mints" },
  { id: "mint", label: "⚡ Mint" },
  { id: "melt", label: "🌩 Melt" },
  { id: "send", label: "📤 Send" },
  { id: "receive", label: "📥 Receive" },
  { id: "debug", label: "🐛 Debug" },
  { id: "adversarial", label: "🔴 Adversarial" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("mints");
  const { total, balances } = useBalances();

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 16, fontFamily: "monospace" }}>
      <header>
        <h1>🥜 Coco Web Wallet</h1>
        <p>
          Total balance: <strong>{total} sats</strong>
        </p>
        {Object.entries(balances).map(([url, b]) => (
          <p key={url}>
            {url}: {b.spendable} spendable / {b.reserved} reserved
          </p>
        ))}
      </header>

      <nav style={{ display: "flex", gap: 8, margin: "16px 0" }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ fontWeight: tab === t.id ? "bold" : "normal" }}>
            {t.label}
          </button>
        ))}
      </nav>

      <main>
        {tab === "mints" && <MintManager />}
        {tab === "mint" && <MintFlow />}
        {tab === "melt" && <MeltFlow />}
        {tab === "send" && <SendFlow />}
        {tab === "receive" && <ReceiveFlow />}
        {tab === "debug" && <DebugPanel />}
        {tab === "adversarial" && <AdversarialPanel />}
      </main>
    </div>
  );
}
```

---

## Phase 11 — Pending Operations Recovery on Boot (15 min)

Add this to your `CocoProvider` so stale operations are triaged on every startup:

```typescript
// inside CocoProvider, after setManager(m):
useEffect(() => {
  if (!manager) return;
  (async () => {
    // Recover any crashed operations
    await manager.ops.mint.recovery.run();
    await manager.ops.melt.recovery.run();
    await manager.ops.send.recovery.run();
    await manager.ops.receive.recovery.run();

    // Surface any prepared sends that need user attention
    const preparedSends = await manager.ops.send.listPrepared();
    if (preparedSends.length > 0) {
      console.warn("[coco] Stale prepared sends found:", preparedSends);
    }
  })();
}, [manager]);
```

---

## Phase 12 — Backup / Export / Seed Management (20 min)

Add a Settings panel with these key actions:

```tsx
import { exportMnemonic, importMnemonic, wipeMnemonic } from "../coco/seed";

export function SettingsPanel() {
  const coco = useCoco();
  const [mnemonic] = useState(() => exportMnemonic());

  return (
    <section>
      <h2>Wallet Settings</h2>

      <div>
        <h3>Backup Mnemonic</h3>
        <p style={{ color: "red" }}>Write this down offline!</p>
        <textarea readOnly value={mnemonic} rows={3} />
        <button onClick={() => navigator.clipboard.writeText(mnemonic)}>Copy Mnemonic</button>
      </div>

      <div>
        <h3>Import Mnemonic</h3>
        {/* input + importMnemonic() call */}
      </div>

      <div>
        <h3>Export Proofs (Cashu Token)</h3>
        <button
          onClick={async () => {
            const mints = await coco.mint.getAllTrustedMints();
            // For each mint, encode existing proofs as a token for offline backup
            // This is advanced — you'd read proofs from repo directly
          }}
        >
          Export Backup Token
        </button>
      </div>
    </section>
  );
}
```

---

## Phase 13 — Multi-Mint Token Handling (15 min)

When you receive a token from an **untrusted mint**, coco will throw `UnknownMintError`.
Catch it and present the user with a choice:

```typescript
import { UnknownMintError } from "@cashu/coco-core";

async function safeReceive(coco: Manager, tokenStr: string) {
  try {
    await coco.wallet.receive(tokenStr);
  } catch (e) {
    if (e instanceof UnknownMintError) {
      const mintUrl = e.mintUrl; // The unknown mint's URL
      const userWantsToTrust = await confirm(`Trust mint ${mintUrl} and receive?`);
      if (userWantsToTrust) {
        await coco.mint.addMint(mintUrl, { trusted: true });
        await coco.wallet.receive(tokenStr); // retry
      }
    } else {
      throw e;
    }
  }
}
```

---

## Phase 14 — Subscription API for Real-Time Quote Updates (15 min)

For better UX in the mint flow, use the subscription API instead of relying
solely on the watcher:

```typescript
// In MintFlow — alternative to polling:
async function waitForPaymentViaSubscription(mintUrl: string, quoteId: string) {
  try {
    await coco.subscription.awaitMintQuotePaid(mintUrl, quoteId);
    // Payment detected — the watcher will auto-execute
    setStatus("Payment detected via WebSocket!");
  } catch {
    // Subscription not supported — fall back to watcher polling
  }
}
```

---

## Testing Checklist

Go through each item manually once the UI is running:

### Core Flows

- [ ] Add testnut mint: `https://nofees.testnut.cashu.space`
- [ ] Mint 21 sats — pay the invoice — confirm `mint-op:finalized` fires
- [ ] Send 10 sats — review fee — create token — copy to clipboard
- [ ] Open a new tab or incognito — paste token — receive — verify balance updates
- [ ] Melt 5 sats — paste any valid BOLT11 — confirm fee screen — pay
- [ ] Add second mint — verify per-mint balance display

### Saga Recovery

- [ ] Prepare a send — close browser — reopen — verify prepared send shown in debug
- [ ] Cancel the stale prepared send — verify proofs released
- [ ] Prepare a melt — close browser — reopen — run melt recovery

### Adversarial Tests (Adversarial Panel)

- [ ] Double-spend test: expect rejection on second receive
- [ ] Corrupt token injection: expect parse error
- [ ] Custom token: paste token with `C` (signature) tampered — expect verification fail
- [ ] Stale send reclaim: verify balance restored (minus swap fee)
- [ ] Send to non-existent mint — expect `UnknownMintError`

### Event Observability

- [ ] Open Debug Panel — trigger each flow — verify events appear in log
- [ ] Confirm `proofs:reserved` fires on prepare, `proofs:released` fires on cancel
- [ ] Confirm `history:updated` fires after each completed operation

---

## Common Pitfalls

| Pitfall                                    | Solution                                                                   |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| `wallet.receive` throws "mint not trusted" | Always `addMint(url, { trusted: true })` first                             |
| `ops.send.execute` fails after `prepare`   | Always `cancel(id)` in the catch block to release proofs                   |
| Melt pending forever                       | Call `ops.melt.refresh(id)` on a timer; handle `rolled_back` state         |
| Balance stale after op                     | Subscribe to `proofs:saved` / `proofs:deleted` events for reactive refresh |
| IndexedDB corruption on dev reload         | Open DevTools → Application → IndexedDB → delete `coco-web-wallet` DB      |
| Watcher not auto-minting                   | Ensure `watchers.mintOperationWatcher: true` in `initializeCoco` config    |
| Concurrent melt calls                      | coco throws `OperationInProgressError` — disable button while executing    |

---

## Dependency Versions (pin these)

```json
{
  "@cashu/coco-core": "^0.x.x",
  "@cashu/coco-indexeddb": "^0.x.x",
  "@scure/bip39": "^1.3.0",
  "qrcode": "^1.5.4"
}
```

> ⚠️ coco is in RC: pin exact versions and read the changelog before upgrading.

---

## Build & Run

```bash
npm run dev       # Vite dev server — http://localhost:5173
npm run build     # Production build
npm run preview   # Preview production build
```

All wallet state lives in IndexedDB. No server required. Works fully offline
after the initial mint connection.
