📄 PRODUCT REQUIREMENTS DOCUMENT (PRD)

1. Product Overview
   Product Name

Coco Web Wallet (PoC)

Objective

Build a browser-based Cashu wallet using the coco library that:

Fully implements the Cashu protocol lifecycle

Exposes all core and advanced features

Acts as an adversarial testing harness to uncover edge cases and limitations

Non-Goals

Native mobile apps (initially)

Production-grade custody guarantees

Fiat on/off ramps

2. Target Users
   Primary

Developers building on Cashu

Protocol researchers

Bitcoin/Lightning engineers

Secondary

Privacy-focused users (experimental usage)

3. Key Value Proposition

Full protocol coverage: exercises all coco APIs

Multi-mint interoperability

Adversarial tooling built-in

Transparent state machine (debuggable wallet)

4. Core User Flows
   4.1 Mint Flow (Receive funds)

User selects mint

Requests Lightning invoice

Pays invoice externally

Wallet:

Generates blinded messages

Sends to mint

Receives signatures

Unblinds → constructs proofs

Proofs stored locally

4.2 Melt Flow (Send to Lightning)

User pastes invoice

Wallet:

Selects proofs

Requests fee reserve

Sends melt request

Mint pays invoice

Change proofs returned (if any)

4.3 Token Send

User selects amount

Wallet splits proofs

Encodes token

Shares via:

QR

Copy string

4.4 Token Receive

User pastes/scans token

Wallet:

Validates format

Verifies proofs

Stores proofs

4.5 Multi-Mint Management

Add/remove mint

View balances per mint

Handle unknown mint tokens

5. Feature Requirements
   5.1 Mint Management

Add mint via URL

Fetch keysets

Track active keyset

Handle key rotation

5.2 Proof Management

Store proofs locally

Track states:

unspent

pending

spent

Split/merge proofs

Coin selection algorithm

5.3 Token Encoding/Decoding

Cashu string format support

QR generation/scanning

Large payload handling

5.4 Lightning Integration

Mint via invoice

Melt via invoice

Fee estimation + reconciliation

Failure recovery

5.5 Persistence

IndexedDB storage

Encrypted at rest (optional for PoC)

Backup/export (token or seed-based)

5.6 Adversarial Testing Features (Critical)

Built-in toggles/tools:

Simulate:

Network failure

Partial mint response

Invalid signatures

Double-spend attempts

Corrupt token injection

Keyset rotation mid-operation

5.7 Observability

Debug panel showing:

Proof state transitions

Mint API calls

Errors/logs

6. UX Principles

Progressive disclosure (basic → advanced)

Explicit state visibility

Deterministic behavior (no hidden magic)

Developer-first UI (debuggable)

7. Success Metrics
   Functional

All coco APIs exercised

All flows (mint/melt/send/receive) working across multiple mints

Reliability

No silent failures

Recoverable from interrupted flows

Testing Depth

Ability to reproduce:

Double-spend scenarios

Keyset mismatches

Invalid proof handling
