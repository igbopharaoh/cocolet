# Cocolet

Cocolet is a browser-based Cashu web wallet and developer test harness built on the official `@cashu/coco-*` package line.

It is designed for two jobs at once:

1. Act as a usable local-first Cashu wallet for minting, melting, sending, and receiving ecash.
2. Expose enough internals, recovery tools, and failure drills to help developers understand and stress-test coco-powered wallet behavior.

## What This Project Includes

- Encrypted local seed vault using Web Crypto
- Browser-local persistence with IndexedDB
- Multi-mint management with trust controls
- Mint, melt, send, and receive flows
- Startup recovery for interrupted operations
- Debug and event-observability panels
- Adversarial testing utilities for failure drills
- Backup, restore, passphrase rotation, wallet replacement, and wipe flows

## Why Cocolet Exists

Cashu wallets are often evaluated only on the happy path. Cocolet is intentionally built to also make unhappy paths visible:

- interrupted operations
- stale prepared sends
- corrupted tokens
- double-spend attempts
- mint trust edge cases
- restore and reclaim behavior

The goal is not just to "have a wallet UI", but to make the protocol lifecycle inspectable and testable in a real browser environment.

## Current Stack

- React 19
- TypeScript 5
- Vite 8
- `@cashu/coco-core`
- `@cashu/coco-indexeddb`
- IndexedDB for wallet data
- Web Crypto for local seed encryption
- QR generation and camera scanning for token flows

## Security Model

This wallet is local-first and does not rely on an application backend.

Important security properties in the current implementation:

- The recovery phrase is not stored in plain text in local storage.
- The wallet vault is encrypted locally with PBKDF2 + AES-GCM before the coco runtime starts.
- Wallet data and proofs live in IndexedDB on the user's device.
- Mint trust is explicit, especially for received tokens from previously unknown mints.
- Destructive actions such as wallet wipe and seed replacement require explicit confirmation.

Important limitations:

- This is still an experimental wallet and test harness.
- Browser storage is only as secure as the browser profile and operating system it runs in.
- There is no server-side backup or sync.
- This repository does not yet include a full automated end-to-end test suite against live mints.

## Feature Overview

### Wallet Gate

On first launch, the app lets you:

- generate a new mnemonic
- import an existing mnemonic
- encrypt the wallet locally with a passphrase

On subsequent launches, you unlock the encrypted vault before the coco runtime initializes.

### Mint Management

- add a mint by URL
- trust or untrust a mint
- refresh mint metadata
- inspect balances and proof counts per mint
- prune removable mints when they are no longer active

### Mint Flow

- select a trusted mint
- request a Lightning invoice
- pay externally
- poll and finalize once paid

### Melt Flow

- paste a Lightning invoice
- prepare a melt
- inspect fee reserve behavior
- execute, refresh, cancel, or reclaim

### Send Flow

- prepare a send
- inspect reserved proofs
- execute into a Cashu token
- share through copy or QR
- cancel or reclaim stale operations

### Receive Flow

- paste or scan a token
- preview decoded token details
- detect unknown/untrusted mints
- trust a mint before claim when needed
- prepare and execute receive

### Debug Panel

- operation visibility
- proof inventory inspection
- history review
- live event log

### Adversarial Panel

- run all recovery routines
- simulate stale send cleanup
- reclaim pending sends
- restore wallet state from seed against a mint
- pause and resume subscriptions
- toggle watcher and processor behavior where supported
- exercise token and flow failure paths

### Settings Panel

- reveal or copy mnemonic
- export spendable proof bundle
- restore proofs from seed for a specific mint
- rotate vault passphrase
- replace wallet mnemonic
- wipe local wallet state

## Project Structure

```text
src/
  coco/         Wallet runtime, vault, and seed helpers
  components/   UI panels and transaction flows
  hooks/        Reactive hooks around coco state and operations
  lib/          Validation, formatting, clipboard, and error helpers
```

High-signal files:

- `src/coco/manager.ts`: coco runtime initialization and IndexedDB wiring
- `src/coco/vault.ts`: encrypted mnemonic vault
- `src/hooks/useCoco.tsx`: runtime bootstrapping and recovery-on-start
- `src/components/WalletShell.tsx`: primary application shell and tab layout
- `src/components/AdversarialPanel.tsx`: failure drills and recovery tools
- `src/components/SettingsPanel.tsx`: backup and destructive controls

## Prerequisites

- Node.js 20 or newer recommended
- npm 10 or newer recommended
- a modern browser with IndexedDB and Web Crypto support

For QR scanning, camera permissions may be required by your browser.

## Installation

```bash
npm install
```

The project currently pins the official scoped coco dependencies directly:

```json
{
  "@cashu/coco-core": "1.0.0-rc.3",
  "@cashu/coco-indexeddb": "1.0.0-rc.3"
}
```

These are pinned intentionally because coco is still distributed on an RC line.

## Running Locally

Start the dev server:

```bash
npm run dev
```

Vite will print the local URL, which is typically:

```text
http://localhost:5173
```

Then:

1. Open the app in your browser.
2. Create or import a wallet.
3. Set a passphrase for the local encrypted vault.
4. Add and trust at least one mint.
5. Start using the mint, melt, send, and receive flows.

## Build, Preview, and Verification

Typecheck the project:

```bash
npm run check
```

Create a production build:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

Current verification approach in this repository:

- `npm run check` validates the TypeScript app and Vite config
- `npm run build` ensures the project bundles successfully
- manual QA is used for wallet and protocol flows

## How To Test The Wallet Today

There is not yet a full automated integration suite in the repository, so the most reliable way to validate behavior is:

1. Run `npm run dev`
2. Use a test mint
3. Walk through the manual flow checklist below

### Recommended Manual QA Checklist

#### Core Flows

- Add a test mint such as `https://nofees.testnut.cashu.space`
- Mint a small amount and verify the mint operation finalizes
- Send a small amount and confirm a token is produced
- Receive that token in a second tab or private window
- Melt a small amount against a valid Lightning invoice
- Add a second mint and verify the wallet separates balances per mint

#### Recovery and Resilience

- Prepare a send, refresh or close the tab, then reopen and inspect recovery state
- Cancel a stale prepared send and verify reserved proofs are released
- Start a melt, interrupt the session, then reopen and run refresh or recovery
- Run all recovery routines from the adversarial panel

#### Trust and Receive Safety

- Paste a token from a trusted mint and claim it
- Paste a token from an unknown mint and verify the app blocks claim until trust is explicit
- Paste malformed or corrupted token data and verify the app surfaces an error

#### Debugging and Observability

- Open the Debug tab while performing each wallet flow
- Confirm history entries appear after completed operations
- Confirm event logs update as proofs and operations transition

#### Settings and Backup

- Export a spendable proof bundle
- Rotate the wallet passphrase
- Restore against a trusted mint
- Verify wipe and seed-replacement confirmations behave as expected

## Test Data Notes

When testing with live infrastructure:

- use small amounts
- prefer known test mints
- expect Lightning invoices and mint behavior to vary by environment
- never treat test success as proof of production readiness

## Local Data and Resetting State

Cocolet stores wallet data locally in the browser:

- encrypted vault in local storage
- wallet proofs and state in IndexedDB

If you need a clean slate during development, use the in-app wipe flow or remove the app's local storage and IndexedDB entries in browser developer tools.

## Performance Notes

The production build currently emits a separate `coco-runtime` chunk. That is intentional, but Vite may still warn that the chunk is large.

This warning does not mean the app is broken. It means the runtime bundle is large enough that you should continue paying attention to:

- startup cost after unlock
- browser parse and execute time
- polling and recovery behavior
- work performed on the main thread

Further optimization work is listed below in the roadmap.

## Known Gaps

- No automated browser E2E suite yet
- No deterministic mock mint environment wired into tests
- No PWA install/offline caching layer yet
- No hardware-backed key storage
- No multi-device sync
- No backend telemetry or crash reporting

## Future Improvements

### Testing

- Add unit tests for validation, vault, formatting, and error helpers
- Add component tests for transaction flows and state transitions
- Add browser E2E coverage with Playwright
- Add mocked mint fixtures for deterministic protocol tests
- Add failure-injection tests for interrupted mint/melt/send/receive operations

### Security

- Harden passphrase UX and rate-limiting semantics
- Consider optional stronger key derivation settings or platform-backed secret storage
- Add backup verification flows so users can confirm recovery data before they need it
- Add explicit session timeout and auto-lock behavior
- Add more rigorous token import validation and audit trails

### Performance

- Lazy-load more of the unlocked wallet runtime
- Move heavier coco work off the main thread where feasible
- Reduce startup scans by making history and proof refresh more incremental
- Improve bundle analysis and chunking strategy
- Pause or reduce background activity when the tab is hidden

### Product and UX

- Better onboarding for first-time Cashu users
- Cleaner status timelines for in-flight operations
- Richer mint metadata and health indicators
- Export and import flows for more backup formats
- Better mobile browser ergonomics

### Protocol and Developer Tooling

- More adversarial toggles for invalid signatures, network faults, and keyset changes
- Structured logs export for debugging wallet sessions
- Reproducible scenario presets for common protocol edge cases
- Compatibility matrix across multiple mint implementations

## Contributing

If you extend this project, please keep these principles intact:

- explicit wallet state over hidden magic
- local-first behavior
- careful treatment of destructive actions
- developer-grade observability
- exact dependency pinning for coco releases

When changing coco versions, review the changelog carefully and rerun both build verification and manual wallet flow checks.

## License

This repository is currently marked `ISC` in `package.json`.
