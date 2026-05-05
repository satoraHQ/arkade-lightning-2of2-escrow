import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import {
  claimSwapToArk,
  startLightningToArkadeSwap,
  subscribeToSwap,
} from '../lendaswap.js';
import type {
  FundingStatus,
  RegisterEscrowResponse,
} from '@arkade-peach-escrow-poc/shared';
import type {SwapStatus} from "@lendasat/lendaswap-sdk-pure";

/**
 * Drives the LN → Arkade swap that pays the escrow.
 *
 * Flow:
 * 1. Click "generate invoice" → SDK creates a Lendaswap swap with the
 *    escrow's Ark address as `targetAddress`. We get back a BOLT11.
 * 2. Display the invoice. Seller pays it from any LN wallet.
 * 3. Poll the swap. Once status reaches `serverfunded`, the Lendaswap
 *    server has funded its side; the seller's SDK then claims the
 *    Arkade VHTLC, paying out to the escrow VTXO address.
 * 4. The Peach server's existing funding poller picks up the new VTXO
 *    and flips the offer to FUNDED.
 */
export function FundOffer({
  offerId,
  escrow,
  amountSats,
  lendaswapApiUrl,
  swapId: initialSwapId,
  invoice: initialInvoice,
  onSwap,
  onFunded,
}: {
  offerId: string;
  escrow: RegisterEscrowResponse;
  amountSats: number;
  lendaswapApiUrl: string | null;
  swapId: string | null;
  invoice: string | null;
  onSwap: (swapId: string, invoice: string) => void;
  onFunded: (status: FundingStatus) => void;
}) {
  const [swapId, setSwapId] = useState<string | null>(initialSwapId);
  const [invoice, setInvoice] = useState<string | null>(initialInvoice);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [swapStatus, setSwapStatus] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [funding, setFunding] = useState<FundingStatus>({
    status: 'PENDING',
    sellAmountSats: amountSats,
  });

  // Server-side funding poll (escrow VTXO appearance).
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await api.funding(offerId);
        if (cancelled) return;
        setFunding(next);
        if (next.status === 'FUNDED') onFunded(next);
      } catch (e) {
        console.error('[fund] funding poll failed:', e);
      }
    };
    void tick();
    const handle = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [offerId, onFunded]);

  // Lendaswap swap status via websocket subscription. SDK reuses one
  // socket across all subscribers; unsubscribing drops our handler and
  // the socket closes once nobody is listening.
  useEffect(() => {
    if (!swapId || !lendaswapApiUrl || claimed) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const handle = async (status: SwapStatus) => {
      if (cancelled) return;
      setSwapStatus(status);
      if (status === 'serverfunded' && !claiming && !claimed) {
        setClaiming(true);
        try {
          await claimSwapToArk(
            lendaswapApiUrl,
            swapId,
            escrow.escrowVtxoArkAddress,
          );
          if (!cancelled) setClaimed(true);
        } catch (e) {
          if (!cancelled) setErr(`claim failed: ${String(e)}`);
        } finally {
          if (!cancelled) setClaiming(false);
        }
      }
    };

    void (async () => {
      try {
        unsubscribe = await subscribeToSwap(lendaswapApiUrl, swapId, handle);
      } catch (e) {
        if (!cancelled) console.error('[fund] swap subscribe failed:', e);
      }
    })();

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, [
    swapId,
    lendaswapApiUrl,
    escrow.escrowVtxoArkAddress,
    claiming,
    claimed,
  ]);

  async function generate() {
    if (!lendaswapApiUrl) {
      setErr('lendaswapApiUrl not loaded yet');
      return;
    }
    setGenerating(true);
    setErr(null);
    try {
      const { response } = await startLightningToArkadeSwap(
        lendaswapApiUrl,
        amountSats,
        escrow.escrowVtxoArkAddress,
      );
      setSwapId(response.id);
      setInvoice(response.bolt11_invoice);
      onSwap(response.id, response.bolt11_invoice);
    } catch (e) {
      setErr(String(e));
    } finally {
      setGenerating(false);
    }
  }

  // Auto-fire generate() once on entry. Manual button remains visible
  // on failure so the seller can retry.
  const autoTriedRef = useRef(false);
  useEffect(() => {
    if (autoTriedRef.current) return;
    if (invoice || !lendaswapApiUrl) return;
    autoTriedRef.current = true;
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lendaswapApiUrl, invoice]);

  return (
    <div className="card">
      <h2>Fund the escrow via Lightning</h2>

      <p className="muted">
        offer: <span className="mono">{offerId}</span>
      </p>
      <p className="muted">escrow Ark address:</p>
      <p className="mono">{escrow.escrowVtxoArkAddress}</p>
      <p>
        amount: <strong>{amountSats}</strong> sats
      </p>

      {!invoice ? (
        <button
          className="primary"
          onClick={generate}
          disabled={generating || !lendaswapApiUrl}
        >
          {generating ? 'creating swap…' : 'generate Lightning invoice'}
        </button>
      ) : (
        <>
          <p className="muted">pay this BOLT11 invoice from any LN wallet:</p>
          <pre className="mono">{invoice}</pre>
          <button
            onClick={() => navigator.clipboard.writeText(invoice).catch(() => {})}
          >
            copy invoice
          </button>
          <p>
            swap status: <strong>{swapStatus ?? 'pending'}</strong>
            {claiming ? ' (claiming…)' : null}
            {claimed ? ' — Ark claim sent, waiting for VTXO confirmation' : null}
          </p>
        </>
      )}

      <p>
        funding status: <strong>{funding.status}</strong>
        {funding.fundingTxid ? (
          <>
            {' '}
            · <span className="mono">{funding.fundingTxid}</span>
          </>
        ) : null}
        {funding.fundedAmountSats !== undefined ? (
          <span className="muted"> · {funding.fundedAmountSats} sats</span>
        ) : null}
      </p>

      {err ? <p style={{ color: 'crimson' }}>{err}</p> : null}
    </div>
  );
}
