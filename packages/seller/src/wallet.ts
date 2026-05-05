import { hex } from '@scure/base';
import { schnorr } from '@noble/curves/secp256k1.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

const SEED_KEY = 'peach-poc-seller:seed-hex';

/**
 * Browser wallet for the seller. Persists a 32-byte random seed in
 * localStorage, unencrypted (PoC only). Per-offer Schnorr keys are
 * derived deterministically via HKDF-SHA256 over the seed.
 *
 * We deliberately skip BIP39 mnemonics here — for the PoC the seed is
 * never displayed or backed up; if the user clears localStorage, every
 * active escrow on this device is unrecoverable.
 */
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

/** Derive a Schnorr keypair for a specific offerId. */
export function deriveOfferKey(seed: Uint8Array, offerId: string): DerivedKey {
  const info = new TextEncoder().encode(`peach-escrow-poc:seller:offer:${offerId}`);
  const sk = hkdf(sha256, seed, undefined, info, 32);
  const pk = schnorr.getPublicKey(sk);
  return { secretKey: sk, publicKey: pk, publicKeyHex: hex.encode(pk) };
}
