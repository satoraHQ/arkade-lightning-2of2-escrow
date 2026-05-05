import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { hex } from '@scure/base';
import { schnorr } from '@noble/curves/secp256k1.js';

/**
 * Peach server's hot key. Persisted as 32 raw bytes on disk. Created on
 * first start if missing. Mode 0600.
 */
export interface PeachIdentity {
  /** 32-byte raw Schnorr secret key. */
  secretKey: Uint8Array;
  /** 32-byte x-only public key. */
  publicKey: Uint8Array;
  publicKeyHex: string;
}

export function loadOrCreatePeachIdentity(path: string): PeachIdentity {
  let secretKey: Uint8Array;
  if (existsSync(path)) {
    const buf = readFileSync(path);
    if (buf.length !== 32) {
      throw new Error(
        `peach key at ${path} has length ${buf.length}, expected 32`,
      );
    }
    secretKey = new Uint8Array(buf);
  } else {
    secretKey = schnorr.utils.randomSecretKey();
    writeFileSync(path, Buffer.from(secretKey), { flag: 'wx' });
    chmodSync(path, 0o600);
    console.log(`[identity] generated new peach hot key at ${path}`);
  }

  const publicKey = schnorr.getPublicKey(secretKey);
  return {
    secretKey,
    publicKey,
    publicKeyHex: hex.encode(publicKey),
  };
}
