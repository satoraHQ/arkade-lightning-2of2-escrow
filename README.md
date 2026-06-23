# arkade-peach-escrow-poc

Proof-of-concept of a [Peach Bitcoin](https://peachbitcoin.com)-style P2P escrow,
lifted from L1 to the [Ark](https://github.com/arkade-os) L2 protocol.

A seller advertises an offer to sell BTC for fiat. Sats are locked in a 3-of-3
Ark VTXO until the buyer pays fiat off-chain. The Peach-style server cosigns
the release together with the seller, paying the buyer directly to an Arkade
address they control.

> **PoC status.** Mutinynet/signet only. Keys held in browser localStorage with
> no encryption. Do not use with real funds.


## Quick start

Three terminals, one recipe each (requires [`just`](https://github.com/casey/just)
and Node 20+):

```bash
just install              # one-time: pull dependencies for all workspaces
just server               # http://localhost:3210  (mutinynet; auto-creates .env)
just server mainnet       # ...or run against mainnet (NETWORK=bitcoin)
just seller               # http://localhost:5173
just buyer                # http://localhost:5174  (server must be up)
```

Faucet with testnet coins:
- https://faucet.mutinynet.com/

## Architecture

```
packages/
  shared/   types, escrow VtxoScript, ark-tx verification helpers
  server/   Express + sqlite. Owns peachServerPk. Cosigner + arbiter.
  seller/   Vite + React. Creates offers, funds via LN, signs releases.
  buyer/    Vite + React. Takes offers, withdraws via LN or L1 redeem.
```

All TypeScript. Shared package will move into the Lendasat SDK once the
shape stabilises.

## Roles

| Role         | Holds                 | Signs                                                    |
|--------------|-----------------------|----------------------------------------------------------|
| Seller       | per-offer Schnorr key | release ark-tx (cooperative leaf)                        |
| Peach server | per-offer Schnorr key | release ark-tx (cooperative leaf), CSV escape after 30d  |
| Arkade ASP   | identity Schnorr key  | release ark-tx (cooperative leaf), round/checkpoint sigs |
| Buyer        | none in any script    | destination commitment message only                      |

The buyer never has a key in any tapleaf. They sign a message committing
to their payout Arkade address; the cooperative spend pays that address
directly.

## Escrow VtxoScript

Two tapleaves under a NUMS internal key:

**Leaf A — cooperative release** (`MultisigTapscript`)

```
<sellerPk>  OP_CHECKSIGVERIFY
<peachPk>   OP_CHECKSIGVERIFY
<aspPk>     OP_CHECKSIG
```

**Leaf B — server-only CSV escape** (`CSVMultisigTapscript`)

```
<csvDelta>  OP_CSV  OP_DROP
<peachPk>   OP_CHECKSIG
```

This mirrors real Peach mainnet, with two differences forced by Ark:

1. **Leaf A is 3-of-3, not 2-of-2.** Real Peach on L1 is `[seller, peach]`
   2-of-2 because there is no third party. On Ark, the ASP is structurally
   involved in every cooperative spend, and the standard convention
   (`DefaultVtxo.Script`, `examples/spilman.js`, `lendasat/ark-escrow`) is
   to put the ASP's pubkey directly in the cooperative tapleaf. This does
   not grant the ASP new veto power — the ASP can already refuse round
   signing and block any spend — it just makes the requirement explicit
   at the script level. Conceptually, seller and Peach remain the two
   policy parties; the ASP is protocol plumbing.
2. The CSV delta is configurable. Real Peach uses 4320 blocks (~30 days);
   we mirror that as the default.

**No seller-alone unilateral exit.** Same as real Peach. Seller safety
against a malicious server comes from the pre-signed refund ark-tx
created at funding time and held by the server. After 30 days of
total stall, only the server can sweep.

Reference: real Peach release tx
[
`31c0512162bd…1234a0`](https://mempool.space/tx/31c0512162bdac7cf4a1d12a2be5f3706fbd93e3b0e6646e80d23c787a1234a0?showDetails=true)
batches 38 escrows in one transaction; each input's witness decodes to
the L1 equivalent of leaf A + leaf B above.

## Lifecycle

```
1. seller       POST /v1/offer { sellAmount, premium, payoutMethods }
                                                                    -> offerId
2. seller       POST /v1/offer/{id}/escrow { sellerPk, returnAddress }
                                                       -> escrowVtxoArkAddress
3. seller       Satora createLightningToArkadeSwap
                claimArkade(swapId, { destinationAddress: escrowVtxoArkAddress })
                                                       (LN -> Ark VHTLC -> escrow)
4. server       polls Arkade; on FUNDED, builds and stores pre-signed refund.
5. buyer        POST /v1/offer/{id}/take { Y, payoutArkAddress, payoutAddressSig }
6. server       builds release ark-tx: input = escrow VTXO, outputs =
                  Y -> buyer payout VTXO,
                  F -> Peach fee VTXO.
                Distributes the cooperative-leaf PSBT.
7. seller       verifyReleaseArkTx, signs leaf A, returns partial sig.
8. server       signs leaf A, requests ASP sig, merges, finalizes,
                submits via arkProvider.submitTx, finalizeTx.
9. buyer        receives VTXO. Optional next step:
                - Satora createArkadeToLightningSwap (LN exit), or
                - Arkade SDK redeem-to-L1 (onchain exit).
```

Full-take only: `Y + F = X`. No partial fills, no change output.

## Signing choreography (cooperative release)

Adapted from `lendasat/ark-escrow/docs/protocol.md`:

```
seller                         server                         ASP
  |                                |                            |
  |   GET /contract/{id}/release   |                            |
  |------------------------------->|                            |
  |    base64 ark-tx PSBT (leaf A) |                            |
  |<-------------------------------|                            |
  | verifyReleaseArkTx             |                            |
  | signEscrowArkTx(psbt, sellerSk)|                            |
  | -> partialA                    |                            |
  |   POST .../release/sellerSig   |                            |
  |------------------------------->|                            |
  |                                | signEscrowArkTx with peachSk
  |                                | merge(partialA, partialPeach)
  |                                | submitTx(arkTx, unsignedCheckpoints)
  |                                |---------------------------->|
  |                                |    server-signed checkpoints
  |                                |<----------------------------|
  |                                | reattach witness_script,
  |                                | sign checkpoints,
  |                                | finalizeTx
  |                                |---------------------------->|
  |                                |        ack                  |
  |                                |<----------------------------|
  |     200 OK { arkTxid }         |                            |
  |<-------------------------------|                            |
```

**Invariant** (lifted from the Rust reference): the seller never reveals
their checkpoint signatures to the server before the server has co-signed
the ark-tx. Otherwise the server could submit checkpoints that lock funds
to itself.

## Per-party signing primitive

Each party uses Satora's
[`signEscrowArkTx`](https://www.npmjs.com/package/@satora/escrow):

```ts
import {signEscrowArkTx} from '@satora/escrow';

const {signedPsbt, txid} = signEscrowArkTx(receivedPsbtB64, sellerSecretKey);
```

It signs input 0 of the PSBT in-place using the leaf+control-block+sighash
that the server pre-attached. It does not finalize. The server merges
all three partial signatures and finalizes.

## Trust model

| Property                                     | Held by           |
|----------------------------------------------|-------------------|
| Seller can prevent release                   | yes (cooperative) |
| Peach can prevent release                    | yes (cooperative) |
| ASP can prevent release                      | yes (cooperative) |
| Seller can sweep funds unilaterally on stall | no                |
| Peach can sweep funds unilaterally on stall  | yes, after CSV    |
| Server proves it controls peachServerPk      | not yet           |

The last row is a known gap copied from real Peach. The client trusts that
the address returned by the server is built from a key Peach controls. We
may close this gap when extracting `shared/` to the Lendasat SDK by having
the server sign a commitment over its pubkey.

## Tech stack

- TypeScript, Node 20+, ESM throughout.
- npm workspaces.
- `@arkade-os/sdk` for VtxoScript, `buildOffchainTx`, `arkProvider`.
- `@satora/swap`, `@satora/escrow`, `@satora/escrow-client` for LN ↔ Ark
  swaps, escrow scripts, and `signEscrowArkTx`.
- Server: Express, sqlite (better-sqlite3).
- Frontends: Vite + React + TypeScript.


## Project layout

```
packages/
  shared/   EscrowVtxoScript, DTOs, verifyReleaseArkTx, signEscrowArkTx,
            payoutCommitmentMessage. Will move into the Lendasat SDK.
  server/   Express + sqlite. Owns peachServerPk. Endpoints:
              POST   /v1/offer
              POST   /v1/offer/:id/escrow
              GET    /v1/offers
              GET    /v1/offer/:id/funding
              POST   /v1/offer/:id/take
              GET    /v1/contract/:id
              GET    /v1/contract/:id/release-psbt   (501)
              POST   /v1/contract/:id/release-sig    (501)
            Background poller watches Arkade for VTXOs at every
            AWAITING_FUNDING escrow address.
  seller/   Vite + React. Five-step flow: wallet → create offer →
            register escrow → fund (LN swap stub) → sign release.
  buyer/    Vite + React. Five-step flow: wallet → browse offers →
            take + commit destination → await release → withdraw stub.
```

## Configuration

Top-level `.env`. The server reads it and the frontends read network config
from the server's `/healthz`, so this is the single place to switch networks.
Two committed samples to copy from:

```bash
cp .env.mutinynet.example .env   # PoC default (signet testnet); `just server` does this for you
cp .env.mainnet.example .env     # mainnet (NETWORK=bitcoin); fill in the <...> endpoints
```

Mutinynet sample:

```
ARK_SERVER_URL=https://mutinynet.arkade.sh
SATORA_API_URL=https://mutinynetswap.lendasat.com
NETWORK=mutinynet
ARK_EXPLORER_URL=https://explorer.mutinynet.arkade.sh
L1_EXPLORER_URL=https://mutinynet.com
PORT=3210
PEACH_SECRET_KEY_PATH=./peach-server.key
DB_PATH=./peach-server.sqlite
FEE_BPS=10
```

The mainnet sample is identical except `NETWORK=bitcoin` and the ASP / swap /
explorer URLs, which you must point at real mainnet endpoints.

Frontend env vars:

```
VITE_SERVER_URL=http://localhost:3210     # if running server elsewhere
```

## References

- Peach app: https://github.com/Peach2Peach/peach-app
- Peach web: https://github.com/Peach2Peach/peach-web
- Arkade TS SDK: https://github.com/arkade-os/ts-sdk
- Satora swap SDK (npm): https://www.npmjs.com/package/@satora/swap
- Satora escrow SDK (npm): https://www.npmjs.com/package/@satora/escrow
- 2-of-3 escrow reference (Rust): https://github.com/satoraHQ/arkade-lightning-2of3-escrow
- Real Peach release tx (
  decoded): https://mempool.space/tx/31c0512162bdac7cf4a1d12a2be5f3706fbd93e3b0e6646e80d23c787a1234a0
