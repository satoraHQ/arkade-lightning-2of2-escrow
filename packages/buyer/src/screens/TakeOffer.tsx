import { useEffect, useMemo, useState } from 'react';
import { hex } from '@scure/base';
import { schnorr } from '@noble/curves/secp256k1.js';
import {
  payoutCommitmentMessage,
  type OfferSummary,
} from '@arkade-peach-escrow-poc/shared';
import { api } from '../api.js';
import { buildPayoutArkAddress, deriveTakeKey, type Wallet } from '../wallet.js';
import { ExplorerAddress } from '../explorer.js';

// mutinynet, signet and testnet all share the `tark` HRP. We only run
// against mutinynet in this PoC, so it's a constant rather than user
// input.
const HRP = 'tark';

export function TakeOffer({
  wallet,
  offer,
  feeBps,
  aspPubKeyHex,
  exitTimelock,
  onTaken,
}: {
  wallet: Wallet;
  offer: OfferSummary;
  feeBps: number;
  aspPubKeyHex: string;
  exitTimelock: { value: number; type: 'blocks' | 'seconds' };
  onTaken: (contractId: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const buyerKey = useMemo(
    () => deriveTakeKey(wallet.seed, offer.offerId),
    [wallet, offer.offerId],
  );

  const expectedFee = Math.floor((offer.sellAmountSats * feeBps) / 10_000);
  const buyerAmount = offer.sellAmountSats - expectedFee;

  const payoutAddress = useMemo(
    () =>
      buildPayoutArkAddress(buyerKey.publicKey, hex.decode(aspPubKeyHex), HRP, {
        value: BigInt(exitTimelock.value),
        type: exitTimelock.type,
      }),
    [buyerKey.publicKey, aspPubKeyHex, exitTimelock.value, exitTimelock.type],
  );

  useEffect(() => {
    setErr(null);
  }, [offer.offerId]);

  async function take() {
    setSubmitting(true);
    setErr(null);
    try {
      const msg = new TextEncoder().encode(
        payoutCommitmentMessage(offer.offerId, payoutAddress),
      );
      const sigBytes = schnorr.sign(msg, buyerKey.secretKey);
      const sig = hex.encode(sigBytes);

      const { contractId } = await api.takeOffer(offer.offerId, {
        amountSats: buyerAmount,
        payoutArkAddress: payoutAddress,
        buyerPubKey: buyerKey.publicKeyHex,
        payoutAddressSig: sig,
      });
      onTaken(contractId);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <h2>Take offer</h2>

      <dl className="kv">
        <dt>offer</dt>
        <dd className="mono">{offer.offerId}</dd>

        <dt>seller offers</dt>
        <dd>{offer.sellAmountSats} sats</dd>

        <dt>you receive</dt>
        <dd>
          <strong>{buyerAmount}</strong> sats
          <span className="muted"> · Peach fee {expectedFee}</span>
        </dd>

        <dt>your per-take pubkey</dt>
        <dd className="mono">{buyerKey.publicKeyHex}</dd>

      </dl>

      <button className="primary" onClick={take} disabled={submitting}>
        {submitting ? 'signing…' : 'take'}
      </button>

      {err ? <p style={{ color: 'crimson' }}>{err}</p> : null}
    </div>
  );
}
