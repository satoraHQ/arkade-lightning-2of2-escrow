import { base64 } from '@scure/base';
import {
  ArkAddress,
  Transaction,
  buildOffchainTx,
  combineTapscriptSigs,
  type ArkTxInput,
} from '@arkade-os/sdk';
import { EscrowVtxoScript } from '@arkade-peach-escrow-poc/shared';
import type { ArkContext } from './ark.js';
import type { PeachIdentity } from './identity.js';

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

export interface BuiltRelease {
  arkTx: Transaction;
  checkpoints: Transaction[];
}

/**
 * Build the cooperative release ark-tx and its checkpoint(s).
 *
 * Deterministic: same inputs produce identical PSBT bytes and txids
 * across calls — this is what lets us rebuild on round 2 instead of
 * persisting state between rounds.
 */
export function buildReleaseTx(
  inputs: BuildReleaseInputs,
  ark: ArkContext,
  peach: PeachIdentity,
): BuiltRelease {
  const escrow = new EscrowVtxoScript({
    sellerPubKey: inputs.sellerPubKey,
    peachServerPubKey: peach.publicKey,
    aspPubKey: ark.aspPubKey,
    exitTimelock: ark.exitTimelock,
  });

  const arkInput: ArkTxInput = {
    txid: inputs.funding.txid,
    vout: inputs.funding.vout,
    value: inputs.funding.valueSats,
    tapLeafScript: escrow.cooperativeLeaf(),
    tapTree: escrow.encode(),
  };

  const buyerAmount = BigInt(inputs.buyerAmountSats);
  const feeAmount = BigInt(inputs.feeSats);
  const buyerAddress = ArkAddress.decode(inputs.buyerArkAddress);
  const peachAddress = ArkAddress.decode(inputs.peachFeeArkAddress);

  const { arkTx, checkpoints } = buildOffchainTx(
    [arkInput],
    [
      {
        script: pkScriptFor(buyerAddress, buyerAmount, ark.info.dust),
        amount: buyerAmount,
      },
      {
        script: pkScriptFor(peachAddress, feeAmount, ark.info.dust),
        amount: feeAmount,
      },
    ],
    ark.serverUnrollScript,
  );

  return { arkTx, checkpoints };
}

/**
 * The ASP rejects any non-OP_RETURN output below `info.dust` (330 sats on
 * mutinynet). Ark addresses expose a {@link ArkAddress.subdustPkScript}
 * that encodes the destination as an OP_RETURN-shaped script for amounts
 * the recipient still wants to receive but that are sub-dust on L1
 * (typical: a 1-sat fee on a small trade).
 */
function pkScriptFor(
  address: ArkAddress,
  amount: bigint,
  dust: bigint,
): Uint8Array {
  return amount < dust ? address.subdustPkScript : address.pkScript;
}

/**
 * Deterministic auxRand so that signing the same PSBT twice yields the
 * same signature. Required because the round-1 peach-signed PSBTs are
 * sent to the seller and come back inside the seller's response in
 * round 2; we then rebuild + peach-sign again on the server side, and
 * `combineTapscriptSigs` would otherwise reject a second peach sig with
 * a different value at the same (pubkey, leafHash) slot.
 */
const DETERMINISTIC_AUX_RAND = new Uint8Array(32);

/** Sign input 0 of the ark-tx and each checkpoint with the peach key. Mutates. */
export function peachSignAll(built: BuiltRelease, peach: PeachIdentity): void {
  built.arkTx.signIdx(peach.secretKey, 0, undefined, DETERMINISTIC_AUX_RAND);
  for (const cp of built.checkpoints) {
    cp.signIdx(peach.secretKey, 0, undefined, DETERMINISTIC_AUX_RAND);
  }
}

/**
 * Submit the (peach + seller)-signed ark-tx with UNSIGNED checkpoints to the
 * ASP, merge the seller+peach checkpoint sigs into the ASP-signed responses,
 * and finalize. Returns the arkTxid.
 *
 * @param fullySignedArkTx ark-tx with both peach and seller tap_script_sigs
 * @param userSignedCheckpoints checkpoints with peach+seller sigs (kept aside)
 * @param unsignedCheckpoints fresh-from-buildOffchainTx checkpoints (no sigs)
 *
 * The submit/finalize split exists so that the ASP can refuse to broadcast a
 * malformed ark-tx without us having spent any checkpoint signatures. Mirrors
 * the pattern in `lendasat/ark-escrow/client.rs:207-274`. Crash recovery
 * between submit and finalize is not implemented for the PoC.
 */
export async function submitAndFinalize(
  ark: ArkContext,
  fullySignedArkTx: Transaction,
  userSignedCheckpoints: Transaction[],
  unsignedCheckpoints: Transaction[],
): Promise<string> {
  const { arkTxid, signedCheckpointTxs } = await ark.provider.submitTx(
    base64.encode(fullySignedArkTx.toPSBT()),
    unsignedCheckpoints.map((c) => base64.encode(c.toPSBT())),
  );

  const finalCheckpoints = signedCheckpointTxs.map((c, i) => {
    const aspSigned = Transaction.fromPSBT(base64.decode(c));
    const userSigned = userSignedCheckpoints[i];
    if (!userSigned) {
      throw new Error(`missing user-signed checkpoint at index ${i}`);
    }
    combineTapscriptSigs(userSigned, aspSigned);
    return base64.encode(aspSigned.toPSBT());
  });

  await ark.provider.finalizeTx(arkTxid, finalCheckpoints);
  return arkTxid;
}
