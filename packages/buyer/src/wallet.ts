import { hex } from '@scure/base';
import { schnorr } from '@noble/curves/secp256k1.js';
import { DefaultVtxo, type RelativeTimelock } from '@arkade-os/sdk';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

const SEED_KEY = 'peach-poc-buyer:seed-hex';

export interface Wallet {
  seed: Uint8Array;
  seedHex: string;
}

export function loadOrCreateWallet(): Wallet {
  let seedHex = localStorage.getItem(SEED_KEY);
  let seed: Uint8Array;
  if (seedHex) {
    seed = hex.decode(seedHex);
    if (seed.length !== 32) {
      seed = crypto.getRandomValues(new Uint8Array(32));
      seedHex = hex.encode(seed);
      localStorage.setItem(SEED_KEY, seedHex);
    }
  } else {
    seed = crypto.getRandomValues(new Uint8Array(32));
    seedHex = hex.encode(seed);
    localStorage.setItem(SEED_KEY, seedHex);
  }
  return { seed, seedHex };
}

export function clearWallet(): void {
  localStorage.removeItem(SEED_KEY);
}

export interface DerivedKey {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
  publicKeyHex: string;
}

/** Fresh keypair per take, derived from seed + offerId. */
export function deriveTakeKey(seed: Uint8Array, offerId: string): DerivedKey {
  const info = new TextEncoder().encode(`peach-escrow-poc:buyer:take:${offerId}`);
  const sk = hkdf(sha256, seed, undefined, info, 32);
  const pk = schnorr.getPublicKey(sk);
  return { secretKey: sk, publicKey: pk, publicKeyHex: hex.encode(pk) };
}

/**
 * Build the buyer's payout Ark address — the destination of the release
 * ark-tx output.
 *
 * Uses `DefaultVtxo`: forfeit leaf `[buyerPk, aspPk]` (cooperative
 * spend), exit leaf `[buyerPk]` after the ASP's unilateral-exit
 * timelock. The timelock MUST be the ASP's reported one (which the
 * SDK Wallet also derives via `delayToTimelock(info.unilateralExitDelay)`)
 * — otherwise the resulting address won't match what `Wallet.create`
 * builds at withdrawal time and the wallet will see a 0 balance.
 */
export function buildPayoutArkAddress(
  buyerPubKey: Uint8Array,
  aspPubKey: Uint8Array,
  hrp: string,
  csvTimelock: RelativeTimelock,
): string {
  return new DefaultVtxo.Script({
    pubKey: buyerPubKey,
    serverPubKey: aspPubKey,
    csvTimelock,
  })
    .address(hrp, aspPubKey)
    .encode();
}
