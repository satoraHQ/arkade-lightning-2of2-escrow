import {
  CSVMultisigTapscript,
  RestArkProvider,
  RestIndexerProvider,
  networks,
  type ArkInfo,
  type Network,
  type NetworkName,
  type RelativeTimelock,
} from '@arkade-os/sdk';
import { hex } from '@scure/base';

export interface ArkContext {
  provider: RestArkProvider;
  indexer: RestIndexerProvider;
  info: ArkInfo;
  network: Network;
  /** ASP's x-only pubkey (32 bytes), used in tapleaves and Ark addresses. */
  aspPubKey: Uint8Array;
  /** ASP's x-only pubkey, hex-encoded (64 chars). */
  aspPubKeyHex: string;
  /**
   * The CSV+multisig tapscript used as the second leaf of every checkpoint
   * VTXO (see `buildOffchainTx`). Decoded once at startup from the ASP's
   * `info.checkpointTapscript`.
   */
  serverUnrollScript: CSVMultisigTapscript.Type;
  /**
   * ASP-mandated unilateral-exit timelock, derived from
   * `info.unilateralExitDelay`. Used for:
   *   - the [peach] unilateral escape leaf in the escrow VtxoScript
   *   - the buyer's payout DefaultVtxo's exit leaf
   * Cannot be shortened — the ASP rejects any unilateral-exit closure
   * with a smaller CSV.
   */
  exitTimelock: RelativeTimelock;
}

export async function connectArk(
  serverUrl: string,
  networkName: NetworkName,
): Promise<ArkContext> {
  const provider = new RestArkProvider(serverUrl);
  const indexer = new RestIndexerProvider(serverUrl);
  const info = await provider.getInfo();
  const network = networks[networkName];
  const aspPubKey = toXOnly(hex.decode(info.signerPubkey));
  const aspPubKeyHex = hex.encode(aspPubKey);

  if (info.network !== networkName) {
    console.warn(
      `[ark] config network=${networkName} but ASP reports network=${info.network}`,
    );
  }

  if (!info.checkpointTapscript) {
    throw new Error(
      `[ark] ASP at ${serverUrl} did not return a checkpointTapscript — cannot build ark transactions`,
    );
  }
  const serverUnrollScript = CSVMultisigTapscript.decode(
    hex.decode(info.checkpointTapscript),
  );
  const exitTimelock = delayToTimelock(info.unilateralExitDelay);
  console.log(
    `[ark] exit timelock (ASP-mandated): ${exitTimelock.value.toString()} ${exitTimelock.type}`,
  );

  return {
    provider,
    indexer,
    info,
    network,
    aspPubKey,
    aspPubKeyHex,
    serverUnrollScript,
    exitTimelock,
  };
}

/**
 * BIP-68: if the relative-timelock value fits in 16 bits (< 512), it's
 * encoded as block height; otherwise it's a 512-second granularity time
 * value. The same rule lives inside @arkade-os/sdk Wallet setup.
 *
 * Time values must be a multiple of 512; we round up to the next
 * multiple so an env override like 1800 (30 min) becomes a valid 2048
 * (~34 min). ASP-reported values are already valid multiples.
 */
function delayToTimelock(delay: bigint): RelativeTimelock {
  if (delay < 512n) {
    return { value: delay, type: 'blocks' };
  }
  const rounded = ((delay + 511n) / 512n) * 512n;
  return { value: rounded, type: 'seconds' };
}

/**
 * Drop the sign byte from a 33-byte compressed secp256k1 pubkey to get
 * the 32-byte x-only form used by BIP-340 / tapscripts. The Arkade ASP
 * returns its `signerPubkey` in compressed form.
 */
function toXOnly(pubkey: Uint8Array): Uint8Array {
  if (pubkey.length === 32) return pubkey;
  if (pubkey.length === 33) return pubkey.subarray(1);
  throw new Error(`unexpected pubkey length ${pubkey.length}`);
}
