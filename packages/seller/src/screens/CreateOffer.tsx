import { useState } from 'react';
import type { RegisterEscrowResponse } from '@arkade-peach-escrow-poc/shared';
import { api } from '../api.js';
import { deriveOfferKey, type Wallet } from '../wallet.js';

/**
 * Combines the two server endpoints into one button click:
 *
 *   1. POST /v1/offer          → server picks an offerId
 *   2. derive seller pubkey from seed + offerId (HKDF)
 *   3. POST /v1/offer/:id/escrow → server returns escrow Ark address
 *
 * The two-step shape is preserved on the wire for faithfulness to
 * the Peach API (Peach derives keys at BIP32 path
 * `m/84'/.../3/<offerId>`, so it also needs the server-assigned
 * offerId before the seller can register a pubkey). The UI just
 * chains them so the seller doesn't have to click twice for what is
 * conceptually one action.
 */
export function CreateOffer({
  wallet,
  onCreated,
}: {
  wallet: Wallet;
  onCreated: (
    offerId: string,
    sellAmountSats: number,
    escrow: RegisterEscrowResponse,
  ) => void;
}) {
  const [sellAmountSats, setSellAmountSats] = useState(1_000);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      setProgress('creating offer…');
      const { offerId } = await api.createOffer({ sellAmountSats });

      const { publicKeyHex } = deriveOfferKey(wallet.seed, offerId);

      setProgress('registering escrow…');
      const escrow = await api.registerEscrow(offerId, {
        sellerPubKey: publicKeyHex,
      });

      onCreated(offerId, sellAmountSats, escrow);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  }

  return (
    <div className="card">
      <h2>Create offer</h2>
      <div className="row">
        <label>sell amount (sats)</label>
        <input
          type="number"
          value={sellAmountSats}
          onChange={(e) => setSellAmountSats(Number(e.target.value))}
        />
      </div>
      <div className="row">
        <button className="primary" disabled={submitting} onClick={submit}>
          {submitting ? 'creating…' : 'create offer'}
        </button>
      </div>
      {progress ? <p className="muted">{progress}</p> : null}
      {err ? <p style={{ color: 'crimson' }}>{err}</p> : null}
    </div>
  );
}
