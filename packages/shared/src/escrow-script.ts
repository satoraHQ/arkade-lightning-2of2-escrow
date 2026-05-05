import {
  CSVMultisigTapscript,
  MultisigTapscript,
  VtxoScript,
  type Network,
  type RelativeTimelock,
} from '@arkade-os/sdk';

export interface EscrowScriptOptions {
  /** x-only Schnorr pubkey, 32 bytes. */
  sellerPubKey: Uint8Array;
  /** x-only Schnorr pubkey, 32 bytes. Held by the Peach-style server. */
  peachServerPubKey: Uint8Array;
  /** x-only Schnorr pubkey, 32 bytes. Arkade ASP's signer key. */
  aspPubKey: Uint8Array;
  /**
   * CSV timelock for the [peach] unilateral escape leaf — the
   * ASP-mandated unilateral-exit closure. Must be ≥ the ASP's
   * `unilateralExitDelay` (~2 days on mutinynet, ~30 days on
   * mainnet) or `submitTx` rejects the script with
   * INVALID_VTXO_SCRIPT "exit delay is too short".
   */
  exitTimelock: RelativeTimelock;
}

/**
 * Two-leaf VtxoScript faithfully porting real Peach's L1 release-tx
 * script to Ark.
 *
 *   A — cooperative release   : 3-of-3 [seller, peach, asp] (no CSV)
 *   B — peach unilateral exit : [peach] alone after long CSV
 *
 * Real Peach on L1 is `[seller, peach]` 2-of-2 + `[peach]` after CSV
 * (decoded from mainnet tx
 * 31c0512162bdac7cf4a1d12a2be5f3706fbd93e3b0e6646e80d23c787a1234a0).
 * The Arkade ASP is added to leaf A as required by Ark's round/forfeit
 * semantics — the ASP must cosign every cooperative VTXO spend.
 *
 * The seller has NO unilateral exit, same as real Peach. Seller safety
 * relies on the pre-signed cooperative refund ark-tx (created at
 * funding time, held by the server).
 */
export class EscrowVtxoScript extends VtxoScript {
  readonly options: EscrowScriptOptions;

  constructor(options: EscrowScriptOptions) {
    const cooperativeLeaf = MultisigTapscript.encode({
      pubkeys: [
        options.sellerPubKey,
        options.peachServerPubKey,
        options.aspPubKey,
      ],
    });

    const escapeLeaf = CSVMultisigTapscript.encode({
      pubkeys: [options.peachServerPubKey],
      timelock: options.exitTimelock,
    });

    super([cooperativeLeaf.script, escapeLeaf.script]);

    this.options = options;
  }

  /** The cooperative-release tapleaf (3-of-3). Index 0. */
  cooperativeLeaf() {
    return this.leaves[0]!;
  }

  /** The peach-only unilateral exit tapleaf (long CSV). Index 1. */
  escapeLeaf() {
    return this.leaves[1]!;
  }

  /** Encoded Ark address (bech32m) for funding this escrow. */
  arkAddress(network: Network): string {
    return this.address(network.hrp, this.options.aspPubKey).encode();
  }
}
