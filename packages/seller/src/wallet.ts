import { hex } from '@scure/base';
import { schnorr } from '@noble/curves/secp256k1.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

const SEED_KEY = 'peach-poc-seller:seed-hex';

/**
 * Browser wallet for the seller. The 32-byte seed is backed by a local file
 * served by the Vite dev plugin (see tools/vite-wallet-seed.mjs) so it
 * survives a localStorage wipe; localStorage is kept as a mirror. Per-offer
 * Schnorr keys are derived deterministically via HKDF-SHA256 over the seed.
 *
 * We deliberately skip BIP39 mnemonics here — PoC only, the seed is stored
 * unencrypted.
 */
export interface Wallet {
  seed: Uint8Array;
  seedHex: string;
}

const SEED_ENDPOINT = '/__wallet_seed';
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Load the wallet seed, preferring the durable file so it survives a
 * localStorage wipe (cleared browser data, a new profile). On first run it
 * migrates an existing localStorage seed into the file so active escrows
 * aren't orphaned. In a production build (no dev endpoint) it falls back to
 * localStorage only.
 */
export async function loadOrCreateWallet(): Promise<Wallet> {
  // 1. Durable file seed is authoritative.
  const fileSeed = await readFileSeed();
  if (fileSeed) {
    localStorage.setItem(SEED_KEY, fileSeed);
    return toWallet(fileSeed);
  }
  // 2. No file yet: migrate an existing localStorage seed, else generate one.
  const local = localStorage.getItem(SEED_KEY);
  let seedHex =
    local && HEX64.test(local)
      ? local
      : hex.encode(crypto.getRandomValues(new Uint8Array(32)));
  // 3. Persist to the file; trust whatever the server ends up holding.
  seedHex = (await writeFileSeed(seedHex)) ?? seedHex;
  localStorage.setItem(SEED_KEY, seedHex);
  return toWallet(seedHex);
}

export async function clearWallet(): Promise<void> {
  localStorage.removeItem(SEED_KEY);
  try {
    await fetch(SEED_ENDPOINT, { method: 'DELETE' });
  } catch {
    // dev endpoint absent (production build) — clearing localStorage is enough
  }
}

function toWallet(seedHex: string): Wallet {
  return { seed: hex.decode(seedHex), seedHex };
}

async function readFileSeed(): Promise<string | null> {
  try {
    const res = await fetch(SEED_ENDPOINT);
    if (!res.ok) return null;
    const { seed } = await res.json();
    return typeof seed === 'string' && HEX64.test(seed) ? seed : null;
  } catch {
    return null;
  }
}

async function writeFileSeed(seedHex: string): Promise<string | null> {
  try {
    const res = await fetch(SEED_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: seedHex }),
    });
    if (!res.ok) return null;
    const { seed } = await res.json();
    return typeof seed === 'string' && HEX64.test(seed) ? seed : null;
  } catch {
    return null;
  }
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
