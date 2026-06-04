import { useEffect, useState } from 'react';
import { Transaction } from '@arkade-os/sdk';
import { base64 } from '@scure/base';
import {
  signEscrowArkTx,
  signEscrowCheckpoints,
  verifyReleaseArkTx,
} from '@satora/escrow';
import type {
  FundingStatus,
  RegisterEscrowResponse,
} from '@arkade-peach-escrow-poc/shared';
import { api } from '../api.js';
import { deriveOfferKey, type Wallet } from '../wallet.js';
import { ExplorerAddress, ExplorerTx } from '../explorer.js';

/**
 * Poll the funding endpoint until a buyer has taken the offer
 * (`contractId` materialises), then let the seller sign the cooperative
 * release ark-tx. The actual sign + submit + finalize lives server-side
 * in `release-sig`.
 */
export function SignRelease({
  wallet,
  offerId,
  escrow,
  funding,
  arkTxid: persistedArkTxid,
  onReleased,
  onStartOver,
}: {
  wallet: Wallet;
  offerId: string;
  escrow: RegisterEscrowResponse;
  funding: FundingStatus | null;
  arkTxid: string | null;
  onReleased: (arkTxid: string) => void;
  onStartOver: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [arkTxid, setArkTxid] = useState<string | null>(persistedArkTxid);
  const [err, setErr] = useState<string | null>(null);
  const [contractId, setContractId] = useState<string | null>(null);

  // Poll until a buyer takes the offer.
  useEffect(() => {
    if (contractId || arkTxid) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const status = await api.funding(offerId);
        if (cancelled) return;
        if (status.contractId) setContractId(status.contractId);
      } catch (e) {
        console.error('[release] funding poll failed:', e);
      }
    };
    void tick();
    const handle = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [offerId, contractId, arkTxid]);

  async function release() {
    if (!contractId) return;
    setWorking(true);
    setErr(null);
    try {
      const psbts = await api.releasePsbt(contractId);

      // Verify the release pays the agreed buyer + fee before signing.
      const arkTx = Transaction.fromPSBT(base64.decode(psbts.arkTxPsbtB64));
      const checkpoints = psbts.checkpointPsbtsB64.map((c) =>
        Transaction.fromPSBT(base64.decode(c)),
      );
      verifyReleaseArkTx(
        { arkTx, checkpoints },
        {
          escrowOutpoint: psbts.expected.escrowOutpoint,
          buyerArkAddress: psbts.expected.buyerArkAddress,
          buyerAmountSats: BigInt(psbts.expected.buyerAmountSats),
          feeArkAddress: psbts.expected.feeArkAddress,
          feeAmountSats: BigInt(psbts.expected.feeAmountSats),
        },
      );

      const { secretKey } = deriveOfferKey(wallet.seed, offerId);
      const sellerSignedArkTx = signEscrowArkTx(
        psbts.arkTxPsbtB64,
        secretKey,
      ).signedPsbt;
      const sellerSignedCheckpoints = signEscrowCheckpoints(
        psbts.checkpointPsbtsB64,
        secretKey,
      );
      const { arkTxid: txid } = await api.releaseSig(contractId, {
        sellerSignedArkTxPsbtB64: sellerSignedArkTx,
        sellerSignedCheckpointPsbtsB64: sellerSignedCheckpoints,
      });
      setArkTxid(txid);
      onReleased(txid);
    } catch (e) {
      setErr(String(e));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="card">
      <h2>Buyer paid fiat → release sats</h2>

      <dl className="kv">
        <dt>offer</dt>
        <dd className="mono">{offerId}</dd>

        <dt>escrow address</dt>
        <dd>
          <ExplorerAddress address={escrow.escrowVtxoArkAddress} />
        </dd>

        {funding?.fundingTxid ? (
          <>
            <dt>funding</dt>
            <dd>
              <ExplorerTx txid={funding.fundingTxid} />
              {funding.fundedAmountSats !== undefined ? (
                <span className="muted"> &middot; {funding.fundedAmountSats} sats</span>
              ) : null}
            </dd>
          </>
        ) : null}

        <dt>arbiter pubkey</dt>
        <dd className="mono">{escrow.arbiterPubKey}</dd>

        <dt>asp pubkey</dt>
        <dd className="mono">{escrow.aspPubKey}</dd>

        <dt>exit timelock</dt>
        <dd>
          {escrow.csvTimelock.value} {escrow.csvTimelock.type}
        </dd>

        {contractId ? (
          <>
            <dt>contract</dt>
            <dd className="mono">{contractId}</dd>
          </>
        ) : null}

        {arkTxid ? (
          <>
            <dt>release ark-tx</dt>
            <dd>
              <ExplorerTx txid={arkTxid} />
            </dd>
          </>
        ) : null}
      </dl>

      {!contractId && !arkTxid ? (
        <p className="muted">Waiting for a buyer to take the offer…</p>
      ) : null}

      {contractId && !arkTxid ? (
        <button className="primary" disabled={working} onClick={release}>
          {working ? 'signing…' : 'release'}
        </button>
      ) : null}

      {arkTxid ? (
        <div className="row">
          <span className="muted">released — sats are now with the buyer.</span>
          <button onClick={onStartOver}>start a new offer</button>
        </div>
      ) : null}

      {err ? <p style={{ color: 'crimson' }}>{err}</p> : null}
    </div>
  );
}
