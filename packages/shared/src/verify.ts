import { ArkAddress, type Transaction } from '@arkade-os/sdk';
import { hex } from '@scure/base';

export interface ReleaseArkTxExpectations {
  /** The escrow VTXO outpoint that must be input 0. */
  escrowOutpoint: { txid: string; vout: number };
  /** Buyer's payout Ark address (committed to during take). */
  buyerArkAddress: string;
  /** Buyer payout amount in sats. */
  buyerAmountSats: bigint;
  /** Peach fee Ark address. */
  peachFeeArkAddress: string;
  /** Peach fee amount in sats. */
  peachFeeAmountSats: bigint;
}

export class ReleaseArkTxValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReleaseArkTxValidationError';
  }
}

/**
 * Seller-side check before signing the cooperative release ark-tx.
 *
 * Mirrors Peach's `verifyReleasePSBT` (peach-app
 * `views/contract/hooks/useConfirmPaymentSeller.tsx:67-83`):
 *   - the funding outpoint must appear as an input
 *   - an output must pay the committed buyer address
 *   - the Peach fee output is paid as agreed
 *
 * Throws on mismatch. Caller should NOT sign if this throws.
 */
export function verifyReleaseArkTx(
  arkTx: Transaction,
  expected: ReleaseArkTxExpectations,
): void {
  if (arkTx.inputsLength !== 1) {
    throw new ReleaseArkTxValidationError(
      `expected exactly 1 input, got ${arkTx.inputsLength}`,
    );
  }

  const input = arkTx.getInput(0);
  if (!input.txid || input.index === undefined) {
    throw new ReleaseArkTxValidationError('input 0 missing prevout');
  }

  const inputTxidHex = hex.encode(input.txid);
  if (
    inputTxidHex !== expected.escrowOutpoint.txid ||
    input.index !== expected.escrowOutpoint.vout
  ) {
    throw new ReleaseArkTxValidationError(
      `input 0 outpoint ${inputTxidHex}:${input.index} does not match expected ${expected.escrowOutpoint.txid}:${expected.escrowOutpoint.vout}`,
    );
  }

  if (arkTx.outputsLength !== 2) {
    throw new ReleaseArkTxValidationError(
      `expected exactly 2 outputs (buyer + peach fee), got ${arkTx.outputsLength}`,
    );
  }

  const buyerPkScript = ArkAddress.decode(expected.buyerArkAddress).pkScript;
  const peachPkScript = ArkAddress.decode(expected.peachFeeArkAddress).pkScript;

  let foundBuyer = false;
  let foundPeach = false;

  for (let i = 0; i < arkTx.outputsLength; i++) {
    const output = arkTx.getOutput(i);
    if (!output.script || output.amount === undefined) continue;

    if (
      bytesEqual(output.script, buyerPkScript) &&
      output.amount === expected.buyerAmountSats
    ) {
      foundBuyer = true;
    } else if (
      bytesEqual(output.script, peachPkScript) &&
      output.amount === expected.peachFeeAmountSats
    ) {
      foundPeach = true;
    }
  }

  if (!foundBuyer) {
    throw new ReleaseArkTxValidationError(
      `no output paying ${expected.buyerAmountSats} sats to buyer ${expected.buyerArkAddress}`,
    );
  }
  if (!foundPeach) {
    throw new ReleaseArkTxValidationError(
      `no output paying ${expected.peachFeeAmountSats} sats to peach fee ${expected.peachFeeArkAddress}`,
    );
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
