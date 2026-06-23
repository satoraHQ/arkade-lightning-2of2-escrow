import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { FundFromLightningHandle } from '@satora/escrow-client';
import type { SwapStatus } from '@satora/swap';
import { api } from '../api.js';
import { claimSwapToArk, subscribeToSwap } from '../satora.js';
import { buildEscrowOptions, getEscrowClient } from '../escrow.js';
import { deriveOfferKey, type Wallet } from '../wallet.js';
import { CopyButton, CopyField, middleEllipsis } from '../ui.js';
import type {
  FundingStatus,
  RegisterEscrowResponse,
} from '@arkade-peach-escrow-poc/shared';

/**
 * Drives the LN → Arkade swap that pays the escrow, via
 * `@satora/escrow-client`'s `fundFromLightning`.
 *
 * Flow:
 * 1. Click "generate invoice" → reconstruct + verify the escrow script,
 *    then `fundFromLightning` creates a Satora swap targeting the escrow
 *    address and starts watching it. We get back a BOLT11 + a handle.
 * 2. Display the invoice. Seller pays it from any LN wallet.
 * 3. On `serverfunded`, `handle.awaitFunded()` claims the Arkade VHTLC into
 *    the escrow and resolves once the VTXO is observed. After a page
 *    refresh the handle is gone, so we fall back to the raw resume claim.
 * 4. The Peach server's funding poller picks up the new VTXO and flips the
 *    offer to FUNDED.
 */
export function FundOffer({
  wallet,
  offerId,
  escrow,
  amountSats,
  satoraApiUrl,
  arkServerUrl,
  swapId: initialSwapId,
  invoice: initialInvoice,
  onSwap,
  onFunded,
  onStartOver,
}: {
  wallet: Wallet;
  offerId: string;
  escrow: RegisterEscrowResponse;
  amountSats: number;
  satoraApiUrl: string | null;
  arkServerUrl: string | null;
  swapId: string | null;
  invoice: string | null;
  onSwap: (swapId: string, invoice: string) => void;
  onFunded: (status: FundingStatus) => void;
  onStartOver: () => void;
}) {
  // The funding handle from `fundFromLightning`, when this page created the
  // swap. Null after a refresh (swapId/invoice come from the persisted
  // session) — the claim then uses the raw resume path below.
  const handleRef = useRef<FundFromLightningHandle | null>(null);
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

  // Satora swap status via websocket subscription. SDK reuses one
  // socket across all subscribers; unsubscribing drops our handler and
  // the socket closes once nobody is listening.
  useEffect(() => {
    if (!swapId || !satoraApiUrl || claimed) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const handle = async (status: SwapStatus) => {
      if (cancelled) return;
      setSwapStatus(status);
      if (status === 'serverfunded' && !claiming && !claimed) {
        setClaiming(true);
        try {
          const handle = handleRef.current;
          if (handle) {
            // escrow-client claims the VHTLC into the escrow and waits for
            // the VTXO to land (5 min absorbs server-funding + indexing lag).
            await handle.awaitFunded(300_000);
          } else {
            // Resume path: page was refreshed after the swap was created, so
            // we no longer hold the handle. Claim directly via the swap client.
            await claimSwapToArk(
              satoraApiUrl,
              swapId,
              escrow.escrowVtxoArkAddress,
            );
          }
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
        unsubscribe = await subscribeToSwap(satoraApiUrl, swapId, handle);
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
    satoraApiUrl,
    escrow.escrowVtxoArkAddress,
    claiming,
    claimed,
  ]);

  async function generate() {
    if (!satoraApiUrl || !arkServerUrl) {
      setErr('config not loaded yet');
      return;
    }
    setGenerating(true);
    setErr(null);
    try {
      const { client, network } = await getEscrowClient(
        satoraApiUrl,
        arkServerUrl,
      );
      const { publicKey: sellerPubKey } = deriveOfferKey(wallet.seed, offerId);
      const options = buildEscrowOptions(sellerPubKey, escrow, network);
      const handle = await client.fundFromLightning({
        escrow: options,
        network,
        amountSats,
      });
      handleRef.current = handle;
      setSwapId(handle.swapId);
      setInvoice(handle.invoice);
      onSwap(handle.swapId, handle.invoice);
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
    if (invoice || !satoraApiUrl || !arkServerUrl) return;
    autoTriedRef.current = true;
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [satoraApiUrl, arkServerUrl, invoice]);

  const swapDone = swapStatus === 'serverfunded' || claiming || claimed;
  const swapLabel = claimed
    ? 'claimed'
    : claiming
      ? 'claiming…'
      : (swapStatus ?? 'pending');

  return (
    <div className="card">
      <h2>Fund the escrow via Lightning</h2>
      <p className="muted">
        offer <span className="mono">{middleEllipsis(offerId, 8, 8)}</span>
      </p>

      <div className="summary">
        <CopyField
          label="escrow Ark address"
          value={escrow.escrowVtxoArkAddress}
          display={middleEllipsis(escrow.escrowVtxoArkAddress, 16, 12)}
        />
        <CopyField
          label="amount"
          value={String(amountSats)}
          display={`${amountSats} sats`}
          mono={false}
        />
      </div>

      {!invoice ? (
        <button
          className="primary"
          onClick={generate}
          disabled={generating || !satoraApiUrl || !arkServerUrl}
        >
          {generating ? 'creating swap…' : 'generate Lightning invoice'}
        </button>
      ) : (
        <div className="invoice-block">
          <div className="field-label">
            pay this BOLT11 invoice from any LN wallet
          </div>
          <a className="qr" href={`lightning:${invoice}`} title="open in wallet">
            <QRCodeSVG value={invoice.toUpperCase()} size={208} marginSize={2} />
          </a>
          <div className="field-row">
            <span className="mono field-value">
              {middleEllipsis(invoice, 14, 12)}
            </span>
            <CopyButton value={invoice} label="copy invoice" />
          </div>
        </div>
      )}

      <div className="status-row">
        <span className={`badge ${swapDone ? 'badge-ok' : ''}`}>
          swap: {swapLabel}
        </span>
        <span
          className={`badge ${funding.status === 'FUNDED' ? 'badge-ok' : ''}`}
        >
          funding: {funding.status}
          {funding.fundedAmountSats !== undefined
            ? ` · ${funding.fundedAmountSats} sats`
            : ''}
        </span>
      </div>
      {funding.fundingTxid ? (
        <p className="muted">
          funding tx{' '}
          <span className="mono">{middleEllipsis(funding.fundingTxid, 12, 12)}</span>
        </p>
      ) : null}

      {err ? <p className="error">{err}</p> : null}

      <div className="row">
        <button
          onClick={() => {
            // An invoice exists → a Lightning payment may be in flight, and
            // abandoning loses track of it. Confirm before discarding.
            if (
              invoice &&
              !window.confirm(
                'Abandon this offer and start over? Any pending Lightning ' +
                  'funding will no longer be tracked here.',
              )
            ) {
              return;
            }
            onStartOver();
          }}
        >
          start over
        </button>
      </div>
    </div>
  );
}
