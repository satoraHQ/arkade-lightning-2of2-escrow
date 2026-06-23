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

const SEED_ENDPOINT = '/__wallet_seed';
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Load the wallet seed, preferring the durable file served by the Vite dev
 * plugin so it survives a localStorage wipe (cleared browser data, a new
 * profile). On first run it migrates an existing localStorage seed into the
 * file so active escrows aren't orphaned. In a production build (no dev
 * endpoint) it falls back to localStorage only.
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
