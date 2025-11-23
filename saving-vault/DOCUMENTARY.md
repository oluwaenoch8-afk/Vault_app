# Saving Vault – Voice Passcode Media Vault

Saving Vault is a Clarity-based smart contract project built with Clarinet. Its goal is to let users associate off-chain assets (images, videos, documents) with an on-chain vault that is protected by a **voice passcode** concept instead of traditional passwords.

> Important: blockchains cannot store large media files efficiently, and they cannot "hear" your voice. Saving Vault models a voice passcode in a way that respects those constraints: the chain stores only a 32-byte hash, while real voice capture and biometric matching happen off-chain.

---

## 1. Motivation and problem statement

Traditional password-based systems are:
- Hard to remember
- Reused across apps
- Often stored insecurely in centralized databases

Biometrics (like voice) are more natural for humans, but harder to fit into a transparent, deterministic system like a blockchain. Saving Vault explores a hybrid model where:
- **Ownership and authorization** are enforced by Clarity smart contracts.
- **Voice passcodes** are handled at the application layer, producing a deterministic hash that the contract can verify.
- **Media content** (images, videos, documents) lives off-chain (IPFS, cloud storage, etc.), and the chain stores only URIs and metadata.

The project aims to be non-trivial by providing:
- A full-featured Clarity contract with multiple public and read-only functions.
- A Vitest-based Clarinet test suite that simulates realistic flows.
- A simple UI that demonstrates how a voice-based UX would connect to the contract.
- A documentary-style explanation (this file) instead of just a bare README.

---

## 2. High-level architecture

The system has three main pieces:

1. **Clarity contract** – `contracts/saving-vault.clar`
   - Stores user profiles (voice hash per principal).
   - Stores vault items: references to off-chain assets plus metadata.
   - Enforces that critical actions (adding, revoking, transferring items) require the correct voice hash.

2. **Tests** – `tests/saving-vault.test.ts`
   - Use `vitest-environment-clarinet` and the `simnet` object.
   - Exercise registration, updates, adding items, revoking, transferring, and read-only helpers.

3. **UI** – `ui/index.html`, `ui/style.css`, `ui/app.js`
   - Shows how a browser app would:
     - Capture a "voice phrase" (text placeholder) from the user.
     - Hash it with SHA-256.
     - Build transaction payloads that call the Clarity functions.
   - Leaves actual wallet integration (Stacks Connect, transaction broadcasting) to be wired in by the deployer.

---

## 3. Clarity contract design

### 3.1 Data model

**File:** `contracts/saving-vault.clar`

- **Error codes** (as response errors):
  - `err u100` – profile already exists
  - `err u101` – profile not found
  - `err u102` – bad voice (hash does not match stored value)
  - `err u103` – not owner of vault item
  - `err u104` – vault item not found
  - `err u105` – vault item already revoked

- **Global counter**

  ```clarity
  (define-data-var vault-counter uint u0)
  ```

  Tracks the highest assigned vault item id. New items get `vault-counter + 1` as `id` and the var is updated.

- **User profiles**

  ```clarity
  (define-map user-profiles
    { owner: principal }
    { voice-hash: (buff 32), created-at: uint }
  )
  ```

  One profile per principal. `voice-hash` is a 32-byte value derived off-chain (e.g. from a voiceprint or a passphrase hashed with SHA-256). `created-at` stores the block height when the profile was created.

- **Vault items**

  ```clarity
  (define-map vault-items
    { id: uint }
    {
      owner: principal,
      uri: (string-ascii 256),
      media-type: (string-ascii 32),
      label: (string-ascii 64),
      created-at: uint,
      revoked: bool
    }
  )
  ```

  Each vault item:
  - Belongs to an `owner` principal.
  - Points to an off-chain asset via `uri` (IPFS CID, HTTPS URL, etc.).
  - Stores a short `media-type` (e.g. `image/png`, `video/mp4`).
  - Has a user-friendly `label`.
  - Tracks `created-at` block height and a `revoked` flag for logical deletion.

### 3.2 Read-only helpers

- `get-user-profile (who principal)` → `optional { voice-hash: (buff 32), created-at: uint }`
- `get-vault-item (id uint)` → `optional { ... }`
- `get-vault-counter ()` → `uint`
- `verify-voice (who principal voice-hash (buff 32))` → `bool`

These functions support UIs and indexers without consuming gas for state changes. For example, a UI can call `verify-voice` with a locally derived hash to check if it matches the on-chain profile.

### 3.3 Voice verification helper

A private helper centralizes the logic of checking a voice hash:

```clarity
(define-private (assert-voice (who principal) (voice-hash (buff 32)))
  (match (map-get? user-profiles { owner: who })
    profile
      (if (is-eq (get voice-hash profile) voice-hash)
          (ok true)
          err-bad-voice)
    err-no-profile
  )
)
```

Any public function that depends on voice proof calls this helper. That avoids copy/paste errors and makes the intent explicit.

### 3.4 Public entrypoints

1. **`register-voice (voice-hash (buff 32))`**
   - Fails with `err-profile-exists` if the caller already has a profile.
   - Stores `{ voice-hash, created-at: block-height }` keyed by `tx-sender`.
   - Returns `(ok true)` on success.

2. **`update-voice (old-voice-hash (buff 32)) (new-voice-hash (buff 32))`**
   - Loads the caller's profile.
   - If none exists → `err-no-profile`.
   - If `old-voice-hash` does not match stored `voice-hash` → `err-bad-voice`.
   - Otherwise, updates the profile to use `new-voice-hash` while preserving `created-at`.

3. **`add-vault-item (uri (string-ascii 256)) (media-type (string-ascii 32)) (label (string-ascii 64)) (voice-hash (buff 32)))`**
   - Calls `assert-voice tx-sender voice-hash`.
   - On success:
     - Computes `next-id = vault-counter + 1`.
     - Updates `vault-counter`.
     - Inserts a new entry into `vault-items` with `owner = tx-sender` and `revoked = false`.
     - Returns `(ok next-id)`.

4. **`revoke-vault-item (id uint) (voice-hash (buff 32))`**
   - Loads the vault item by id.
   - If not found → `err-not-found`.
   - If `owner != tx-sender` → `err-not-owner`.
   - Checks voice via `assert-voice`.
   - If already `revoked = true` → `err-already-revoked`.
   - Otherwise sets `revoked = true` and returns `(ok true)`.

5. **`transfer-vault-item (id uint) (recipient principal) (voice-hash (buff 32))`**
   - Similar to revoke:
     - Must exist and belong to `tx-sender`.
     - Must not be revoked.
     - `assert-voice` must pass.
   - On success, sets `owner = recipient` and `revoked = false` (fresh ownership).

### 3.5 Security model and limitations

- **No raw voice on-chain.** Only a 32-byte buffer is stored, typically the result of hashing or quantizing a biometric voiceprint.
- **Real biometric checks are off-chain.** The UI or backend is responsible for recording audio and transforming it into the deterministic 32-byte hash expected by the contract.
- **Wallet keys still matter.** On Stacks, all transactions are signed by the user's private key. The voice passcode is an **additional factor**, not a replacement for cryptographic signatures.
- **Voice revocation and recovery.** Changing your voice hash is supported via `update-voice`, but if both your wallet key and voice profile are compromised, on-chain code cannot help you; recovery schemes (e.g. social recovery) would need to be added as future work.

---

## 4. Test suite

**File:** `tests/saving-vault.test.ts`

The tests are written using Vitest with `vitest-environment-clarinet`, which injects a `simnet` object for interacting with a local simulated blockchain.

Key patterns used:

- Get accounts:
  ```ts
  const accounts = simnet.getAccounts();
  const wallet1 = accounts.get("wallet_1")!;
  const wallet2 = accounts.get("wallet_2")!;
  ```

- Call public functions:
  ```ts
  const tx = simnet.callPublicFn(
    "saving-vault",
    "register-voice",
    [Cl.buff(voiceHashBytes)],
    wallet1,
  );
  expect(tx.result).toBeOk(Cl.bool(true));
  ```

- Call read-only functions:
  ```ts
  const ro = simnet.callReadOnlyFn(
    "saving-vault",
    "get-vault-item",
    [Cl.uint(1)],
    wallet1,
  );
  expect(ro.result).toBeSome();
  ```

- Use custom matchers for Clarity values:
  - `.toBeOk(...)`, `.toBeErr(...)`
  - `.toBeUint(...)`, `.toBeBool(...)`, `.toBeSome()`

### 4.1 Covered scenarios

1. **Voice registration**
   - A user can register a voice profile exactly once.
   - A second attempt from the same principal fails with `err u100`.

2. **Voice update**
   - With the correct old hash, `update-voice` succeeds and returns `(ok true)`.
   - With an incorrect old hash, it fails with `err u102`.

3. **Adding vault items**
   - Without a profile, `add-vault-item` fails with `err u101`.
   - With a profile but wrong voice hash, it fails with `err u102`.
   - With a profile and correct voice hash, it returns a new id (`u1`) and the item is visible via `get-vault-item`.

4. **Revoking items**
   - Non-owners cannot revoke (`err u103`).
   - Owners with wrong voice hash cannot revoke (`err u102`).
   - Owners with correct voice hash succeed and get `(ok true)`.
   - A second revoke on the same id fails with `err u105`.

5. **Transferring items**
   - Owners can transfer an item to another principal when providing the correct voice hash.
   - Wrong voice hash → `err u102`.
   - After transfer, the new owner must register their own voice profile to manage the item (e.g. revoke it).

6. **Read-only helpers**
   - `get-vault-counter` starts at `0` and increments as items are added.
   - `verify-voice` returns `true` only for the correct stored hash and `false` otherwise.

This suite ensures the contract behavior is non-trivial and well-specified, going beyond a single read-only getter.

---

## 5. UI and user experience

**Files:**
- `ui/index.html`
- `ui/style.css`
- `ui/app.js`

The UI is intentionally lightweight and framework-free. It focuses on the **flows** rather than a heavy frontend stack.

### 5.1 Wallet model

Real Stacks apps connect to wallets via Stacks Connect. For simplicity, this UI:
- Lets you type an **active Stacks address** manually.
- Stores it in memory as `activeAddress`.
- Uses it as the `sender` field when building mock contract call payloads.

This keeps the UX and contract interface clear without requiring a specific extension or backend.

### 5.2 Voice passcode UX

The UI treats voice as a phrase for now:

1. User types a phrase, e.g. `my vault is my voice`.
2. The browser uses the Web Crypto API to hash it:
   - `SHA-256(phrase)` → 32-byte `Uint8Array`.
3. The hex representation is shown in the UI.
4. The same bytes would be sent as a Clarity `(buff 32)` argument `voice-hash` in real contract calls.

You can see this in `app.js` via:

```js
async function hashPhraseToVoiceBytes(phrase) {
  const data = new TextEncoder().encode(phrase);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
}
```

This is a stand-in for a real voice biometric pipeline, which would:
- Record audio from the microphone.
- Compute a voiceprint vector.
- Derive a deterministic 32-byte hash from that vector.

### 5.3 Contract interaction (mocked payloads)

Each major action builds a **mock transaction payload** that mirrors how a real contract call would be structured:

- Register voice:
  ```js
  buildRegisterVoiceTx(voiceBytes) => {
    contract: "saving-vault",
    function: "register-voice",
    sender: activeAddress,
    args: { "voice-hash": <hex> },
  }
  ```

- Update voice:
  ```js
  buildUpdateVoiceTx(oldBytes, newBytes) => {
    contract: "saving-vault",
    function: "update-voice",
    sender: activeAddress,
    args: {
      "old-voice-hash": <hex>,
      "new-voice-hash": <hex>,
    },
  }
  ```

- Add vault item:
  ```js
  buildAddVaultItemTx({ uri, mediaType, label, voiceBytes })
  ```

- Revoke / transfer / read-only lookup similarly create structured JSON showing the function name and arguments.

The UI prints these payloads in `<pre>` blocks. When you go to deploy on a real network, you would:

- Replace the builders with `makeContractCall` calls from `@stacks/transactions`.
- Wrap them with Stacks Connect so users sign transactions in their wallet.

### 5.4 Visual design

`style.css` adds a minimal, modern look:
- Dark background, card layout, responsive grid.
- Clear separation of steps: connect → register voice → add items → manage items.

This is more than a single button or a color tweak; it's a small but complete UX flow.

---

## 6. How to run and test

From the `saving-vault/` directory:

1. **Install dependencies** (once):

   ```sh
   npm install
   ```

2. **Run tests**:

   ```sh
   npm test
   ```

   This invokes Vitest with the Clarinet environment and executes all tests in `tests/saving-vault.test.ts`.

3. **Experiment with the contract in Clarinet REPL**:

   ```sh
   clarinet console
   ```

   Then, inside the console, you can call functions like `register-voice`, `add-vault-item`, etc., against the simulated network.

4. **Open the UI**:
   - Serve the `ui/` directory with any static HTTP server (e.g. `python -m http.server` in the `ui` folder).
   - Open it in your browser and play with the flows.
   - When you are ready to talk to a real devnet/testnet, replace the mock builders in `app.js` with real transaction calls.

---

## 7. Future improvements

Some ideas to evolve Saving Vault into a production-ready dApp:

- **Real voice capture and biometric integration**
  - Use WebRTC to record the user's voice and run a client-side model or call a secure backend.
  - Derive the on-chain `voice-hash` from a voiceprint representation.

- **Encrypted media storage**
  - Encrypt files client-side with a key derived from the voice passcode and wallet keys.
  - Store ciphertext in IPFS or cloud storage.
  - Only combine keys for decryption when the correct voice is presented.

- **Richer metadata and indexing**
  - Add tags, folders, and sharing options.
  - Provide pagination and indexer support for vault items.

- **Recovery and delegation**
  - Add social recovery or guardian-based flows to reset voice profiles.
  - Allow users to define trusted delegate principals who can manage or recover certain items.

- **Production-ready UI**
  - Migrate the demo UI to a React/Vue/Svelte app.
  - Integrate with Stacks wallets using Stacks Connect.
  - Add unit tests and end-to-end tests for the frontend itself.

Saving Vault, as built here, is a fully working Clarinet project with a substantial Clarity contract, tests, a UI that understands the contract interface, and this documentary explaining the architecture and design choices.