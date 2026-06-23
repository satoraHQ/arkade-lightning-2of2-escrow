import { hex } from '@scure/base';
import type { ArkContext } from './ark.js';
import type { Store } from './store.js';

const POLL_INTERVAL_MS = 5_000;

/**
 * Background loop that polls the Arkade indexer for VTXOs at every
 * AWAITING_FUNDING escrow address. Marks the offer FUNDED once the
 * total amount across unspent VTXOs reaches the expected sellAmount.
 *
 * For the PoC this is naive (one query per AWAITING_FUNDING offer per
 * tick). Real impl would use indexer subscriptions.
 */
export function startFundingPoller(store: Store, ark: ArkContext): () => void {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const offers = Array.from(store.offers.values()).filter(
        (o) => o.status === 'AWAITING_FUNDING' && o.escrowPkScript,
      );

      for (const offer of offers) {
        const scriptHex = hex.encode(offer.escrowPkScript!);
        const result = await ark.indexer.getVtxos({
          scripts: [scriptHex],
          spendableOnly: true,
        });

        const unspent = result.vtxos.filter((v) => !v.isSpent);
        if (unspent.length === 0) continue;

        // VirtualCoin extends Coin: { value: number (sats), txid, vout, ... }
        const totalSats = unspent.reduce((acc, v) => acc + v.value, 0);

        if (totalSats < offer.sellAmountSats) {
          console.log(
            `[poll] offer ${offer.id} partial funding ${totalSats}/${offer.sellAmountSats} sats — waiting`,
          );
          continue;
        }

        // Use the first VTXO's outpoint as the canonical funding ref.
        // Full-take semantics expect exactly one funding VTXO; multiple
        // VTXOs at the same address would be the seller funding in chunks.
        const first = unspent[0]!;

        // Re-check status before mutating in case the offer was cancelled
        // between filter and update. Single-threaded JS makes this rare,
        // but stays consistent under future async refactors.
        if (offer.status !== 'AWAITING_FUNDING') continue;
        offer.status = 'FUNDED';
        offer.fundingTxid = first.txid;
        offer.fundingVout = first.vout;
        offer.fundedAmountSats = totalSats;
        store.saveOffer(offer);

        console.log(
          `[poll] offer ${offer.id} funded with ${totalSats} sats across ${unspent.length} VTXO(s); canonical=${first.txid}:${first.vout}`,
        );
      }
    } catch (err) {
      console.error('[poll] error:', err);
    }
  };

  const handle = setInterval(tick, POLL_INTERVAL_MS);
  void tick();

  return () => {
    stopped = true;
    clearInterval(handle);
  };
}
