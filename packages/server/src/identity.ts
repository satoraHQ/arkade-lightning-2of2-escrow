import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { hex } from '@scure/base';
import { schnorr } from '@noble/curves/secp256k1.js';

/**
 * Peach server's hot key. Persisted as a 64-char hex string on disk (same
 * pattern as the buyer/seller wallet seeds), at the monorepo root by default.
 * Created on first start if missing. Mode 0600.
 */
export interface PeachIdentity {
  /** 32-byte raw Schnorr secret key. */
  secretKey: Uint8Array;
  /** 32-byte x-only public key. */
  publicKey: Uint8Array;
  publicKeyHex: string;
}

const HEX64 = /^[0-9a-f]{64}$/i;

export function loadOrCreatePeachIdentity(path: string): PeachIdentity {
  let secretKey: Uint8Array;
  if (existsSync(path)) {
    secretKey = parseKeyFile(path);
  } else {
    secretKey = schnorr.utils.randomSecretKey();
    writeFileSync(path, hex.encode(secretKey), { flag: 'wx', mode: 0o600 });
    console.log(`[identity] generated new peach hot key at ${path}`);
  }

  const publicKey = schnorr.getPublicKey(secretKey);
  return {
    secretKey,
    publicKey,
    publicKeyHex: hex.encode(publicKey),
  };
}

/** Parse the key file: 64-char hex (current), or 32 raw bytes (legacy). */
function parseKeyFile(path: string): Uint8Array {
  const buf = readFileSync(path);
  const text = buf.toString('utf8').trim();
  if (HEX64.test(text)) return hex.decode(text.toLowerCase());
  if (buf.length === 32) return new Uint8Array(buf); // legacy raw-bytes file
  throw new Error(
    `peach key at ${path} is neither 64-char hex nor 32 raw bytes (len ${buf.length})`,
  );
}
