import { ArkAddress, buildOffchainTx, type Transaction } from '@arkade-os/sdk';
import {
  type BuiltEscrowRelease,
  buildEscrowReleaseTx,
  type EscrowArkConfig,
  EscrowVtxoScript,
  signEscrowReleaseInPlace,
  submitAndFinalizeEscrowRelease,
} from '@satora/escrow';
import type { ArkContext } from './ark.js';
import type { PeachIdentity } from './identity.js';

export type BuiltRelease = BuiltEscrowRelease;

export interface BuildReleaseInputs {
  /** Seller's x-only Schnorr pubkey, 32 bytes. */
  sellerPubKey: Uint8Array;
  /** The funding VTXO. */
  funding: { txid: string; vout: number; valueSats: number };
  /** Buyer's payout Ark address (committed at take time). */
  buyerArkAddress: string;
  /** Sats paid to the buyer. */
  buyerAmountSats: number;
  /** Sats paid to the Peach fee output. */
  feeSats: number;
  /** Server's fee-collection Ark address. */
  peachFeeArkAddress: string;
}

/** ASP-derived config for the escrow release, from the connected ArkContext. */
function escrowConfig(ark: ArkContext): EscrowArkConfig {
  return {
    arkadeServerPubKey: ark.aspPubKey,
    exitTimelock: ark.exitTimelock,
    serverUnrollScript: ark.serverUnrollScript,
    dust: ark.info.dust,
  };
}

/**
 * Build the cooperative release ark-tx and its checkpoint(s).
 * Deterministic: same inputs → identical PSBT bytes.
 *
 * When `feeSats` is 0 we build a SINGLE buyer output ourselves: the
 * `@satora/escrow` SDK always emits a buyer + fee pair, and a 0-sat fee
 * output is rejected by the ASP (`AMOUNT_TOO_LOW`). With a fee we use the
 * SDK's two-output builder.
 */
export function buildReleaseTx(
  inputs: BuildReleaseInputs,
  ark: ArkContext,
  peach: PeachIdentity,
): BuiltRelease {
  const escrow = new EscrowVtxoScript({
    sellerPubKey: inputs.sellerPubKey,
    arbiterPubKey: peach.publicKey,
    arkadeServerPubKey: ark.aspPubKey,
    exitTimelock: ark.exitTimelock,
  });

  if (inputs.feeSats <= 0) {
    return buildBuyerOnlyRelease(escrow, inputs, ark);
  }

  return buildEscrowReleaseTx(
    escrow,
    inputs.funding,
    {
      buyerArkAddress: inputs.buyerArkAddress,
      buyerAmountSats: inputs.buyerAmountSats,
      feeArkAddress: inputs.peachFeeArkAddress,
      feeSats: inputs.feeSats,
    },
    escrowConfig(ark),
  );
}

/**
 * Single-output cooperative release (buyer gets the full amount, no fee
 * output). Mirrors what the SDK's `buildEscrowReleaseTx` does internally,
 * minus the fee output. `buildOffchainTx` still adds the zero-value P2A
 * fee-bump anchor.
 */
function buildBuyerOnlyRelease(
  escrow: EscrowVtxoScript,
  inputs: BuildReleaseInputs,
  ark: ArkContext,
): BuiltRelease {
  const buyer = ArkAddress.decode(inputs.buyerArkAddress);
  const amount = BigInt(inputs.buyerAmountSats);
  const script =
    amount < ark.info.dust ? buyer.subdustPkScript : buyer.pkScript;

  const { arkTx, checkpoints } = buildOffchainTx(
    [
      {
        txid: inputs.funding.txid,
        vout: inputs.funding.vout,
        value: inputs.funding.valueSats,
        tapLeafScript: escrow.cooperativeLeaf(),
        tapTree: escrow.encode(),
      },
    ],
    [{ script, amount }],
    ark.serverUnrollScript,
  );
  return { arkTx, checkpoints };
}

/** Sign input 0 of the ark-tx and each checkpoint with the peach key. Mutates. */
export function peachSignAll(built: BuiltRelease, peach: PeachIdentity): void {
  signEscrowReleaseInPlace(built, peach.secretKey);
}

/**
 * Submit the (peach + seller)-signed ark-tx with UNSIGNED checkpoints to the
 * ASP, merge in the ASP's checkpoint sigs, and finalize. Returns the arkTxid.
 */
export function submitAndFinalize(
  ark: ArkContext,
  fullySignedArkTx: Transaction,
  userSignedCheckpoints: Transaction[],
  unsignedCheckpoints: Transaction[],
): Promise<string> {
  return submitAndFinalizeEscrowRelease(
    ark.provider,
    fullySignedArkTx,
    userSignedCheckpoints,
    unsignedCheckpoints,
  );
}
