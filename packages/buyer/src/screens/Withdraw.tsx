import { useEffect, useState } from 'react';
import { SingleKey, Wallet } from '@arkade-os/sdk';
import type { ContractStatus } from '@arkade-peach-escrow-poc/shared';
import { deriveTakeKey, type Wallet as PoCWallet } from '../wallet.js';
import { getEscrowClient } from '../escrow.js';
import { ExplorerTx, L1ExplorerTx } from '../explorer.js';
import { CopyButton, middleEllipsis } from '../ui.js';

type Mode = 'onchain' | 'lightning';

/**
 * Once the release ark-tx is broadcast, the buyer's payout VTXO is
 * spendable. This screen withdraws it via `@satora/escrow-client`:
 *
 *   - onchain   → `withdrawToL1`: collaborative Arkade offboard (settlement
 *     round) to an L1 bech32 address.
 *   - lightning → `withdrawToLightning`: an Arkade→Lightning swap whose VHTLC
 *     is funded from the payout, paying a BOLT11 invoice / LNURL / address.
 *
 * For the PoC we instantiate an @arkade-os/sdk Wallet on the fly with the
 * buyer's per-take key as its SingleKey identity (in-memory storage; the
 * seed in localStorage rebuilds everything on next load) and hand it to the
 * escrow-client, which owns the offboard / swap mechanics.
 *
 * The lightning withdrawal sends the full available payout: the recipient
 * amount (payout minus the swap fee) comes from the SDK quote, so there is no
 * amount field. A BOLT11 invoice carries its own amount and ignores the quote.
 */
export function Withdraw({
  wallet: pocWallet,
  offerId,
  arkServerUrl,
  lendaswapApiUrl,
  exitTimelock,
  status,
}: {
  wallet: PoCWallet;
  offerId: string;
  arkServerUrl: string;
  lendaswapApiUrl: string;
  exitTimelock: { value: number; type: 'blocks' | 'seconds' };
  status: ContractStatus;
}) {
  const [mode, setMode] = useState<Mode>('onchain');
  const [destination, setDestination] = useState('');
  // A BOLT11 invoice, LNURL, or Lightning address. The swap backend resolves
  // LNURL / address, so we just pass the raw string through.
  const [lnDest, setLnDest] = useState('');
  const [lnQuote, setLnQuote] = useState<{ recipientSats: number } | null>(null);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [l1Txid, setL1Txid] = useState<string | null>(null);
  const [lnResult, setLnResult] = useState<{
    fundingTxid: string;
    sourceAmountSats: number;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [balance, setBalance] = useState<{ available: bigint } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchBalance() {
      try {
        const sdk = await openWallet(pocWallet, offerId, arkServerUrl, exitTimelock);
        const b = await sdk.getBalance();
        if (cancelled) return;
        setBalance({ available: BigInt(b.available ?? 0) });
      } catch (e) {
        console.error('[withdraw] getBalance failed:', e);
      }
    }
    void fetchBalance();
    return () => {
      cancelled = true;
    };
  }, [pocWallet, offerId, arkServerUrl, exitTimelock.value, exitTimelock.type]);

  // Quote the recipient amount for a full-payout Lightning withdrawal (payout
  // minus the swap fee) for display + to hand the swap. The SDK owns the fee
  // math, so the user never types an amount.
  useEffect(() => {
    if (mode !== 'lightning' || !balance) return;
    let cancelled = false;
    void (async () => {
      try {
        const escrowClient = await getEscrowClient(lendaswapApiUrl, arkServerUrl);
        const { recipientSats } = await escrowClient.quoteLightningWithdrawal(
          Number(balance.available),
        );
        if (!cancelled) setLnQuote({ recipientSats });
      } catch (e) {
        console.error('[withdraw] lightning quote failed:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, balance, lendaswapApiUrl, arkServerUrl]);

  async function withdraw() {
    setWorking(true);
    setErr(null);
    setL1Txid(null);
    setLnResult(null);
    setProgress('opening wallet…');
    try {
      const sdk = await openWallet(pocWallet, offerId, arkServerUrl, exitTimelock);
      const escrowClient = await getEscrowClient(lendaswapApiUrl, arkServerUrl);

      if (mode === 'onchain') {
        setProgress('joining settlement round (this can take a minute)…');
        const txid = await escrowClient.withdrawToL1({
          wallet: sdk,
          destinationAddress: destination,
        });
        setL1Txid(txid);
      } else {
        // Recipient amount = full available payout minus the swap fee, from the
        // SDK quote. Ignored by the SDK for a BOLT11 invoice (it has its own).
        setProgress('quoting…');
        const { recipientSats } =
          lnQuote ??
          (await escrowClient.quoteLightningWithdrawal(
            Number((await sdk.getBalance()).available ?? 0),
          ));
        setProgress('creating Arkade→Lightning swap & funding VHTLC…');
        const res = await escrowClient.withdrawToLightning({
          wallet: sdk,
          destination: lnDest,
          amountSats: recipientSats,
        });
        setLnResult({
          fundingTxid: res.fundingTxid,
          sourceAmountSats: res.sourceAmountSats,
        });
      }
      setProgress(null);
    } catch (e) {
      setErr(String(e));
      setProgress(null);
    } finally {
      setWorking(false);
    }
  }

  const canSubmit =
    mode === 'onchain' ? Boolean(destination) : Boolean(lnDest);

  return (
    <div className="card">
      <h2>Withdraw</h2>

      <div className="summary">
        {status.arkTxid ? (
          <div className="field">
            <div className="field-label">sats released (ark-tx)</div>
            <div className="field-row">
              <span className="field-value">
                <ExplorerTx txid={status.arkTxid}>
                  {middleEllipsis(status.arkTxid, 14, 12)}
                </ExplorerTx>
              </span>
              <CopyButton value={status.arkTxid} />
            </div>
          </div>
        ) : null}
        <div className="field">
          <div className="field-label">available in payout VTXO</div>
          <div className="field-row">
            <span className="field-value">
              {balance ? (
                <>
                  <strong>{balance.available.toString()}</strong> sats
                </>
              ) : (
                <span className="muted">loading…</span>
              )}
            </span>
          </div>
        </div>
      </div>

      <div className="row">
        <label>method</label>
        <div>
          <label>
            <input
              type="radio"
              name="withdraw-mode"
              checked={mode === 'onchain'}
              onChange={() => setMode('onchain')}
            />{' '}
            onchain (L1)
          </label>{' '}
          <label>
            <input
              type="radio"
              name="withdraw-mode"
              checked={mode === 'lightning'}
              onChange={() => setMode('lightning')}
            />{' '}
            lightning
          </label>
        </div>
      </div>

      {mode === 'onchain' ? (
        <div className="row">
          <label>L1 destination (bech32)</label>
          <input
            value={destination}
            placeholder="tb1q…"
            onChange={(e) => setDestination(e.target.value)}
          />
        </div>
      ) : (
        <>
          <div className="row">
            <label>invoice / LNURL / address</label>
            <input
              value={lnDest}
              placeholder="lnbc… · lnurl1… · user@host"
              onChange={(e) => setLnDest(e.target.value)}
            />
          </div>
          <p className="muted">
            Withdraws your full payout.{' '}
            {lnQuote
              ? `For an LNURL / address the recipient gets ≈ ${lnQuote.recipientSats} sats after the swap fee; a BOLT11 invoice uses its own amount.`
              : 'The recipient amount (payout minus the swap fee) is set by the SDK; a BOLT11 invoice uses its own amount.'}
          </p>
        </>
      )}

      <div className="row">
        <button
          className="primary"
          onClick={withdraw}
          disabled={working || !canSubmit}
        >
          {working
            ? 'withdrawing…'
            : `withdraw to ${mode === 'onchain' ? 'L1' : 'Lightning'}`}
        </button>
      </div>

      {progress ? <p className="muted">{progress}</p> : null}

      {l1Txid ? (
        <>
          <div className="status-row">
            <span className="badge badge-ok">withdrawn to L1</span>
          </div>
          <div className="field">
            <div className="field-label">settlement txid (L1)</div>
            <div className="field-row">
              <span className="field-value">
                <L1ExplorerTx txid={l1Txid}>
                  {middleEllipsis(l1Txid, 14, 12)}
                </L1ExplorerTx>
              </span>
              <CopyButton value={l1Txid} />
            </div>
          </div>
        </>
      ) : null}

      {lnResult ? (
        <>
          <div className="status-row">
            <span className="badge badge-ok">
              paid via Lightning · {lnResult.sourceAmountSats} sats
            </span>
          </div>
          <div className="field">
            <div className="field-label">VHTLC funding (ark-tx)</div>
            <div className="field-row">
              <span className="field-value">
                <ExplorerTx txid={lnResult.fundingTxid}>
                  {middleEllipsis(lnResult.fundingTxid, 14, 12)}
                </ExplorerTx>
              </span>
              <CopyButton value={lnResult.fundingTxid} />
            </div>
          </div>
        </>
      ) : null}

      {err ? <p className="error">{err}</p> : null}
    </div>
  );
}

/**
 * Cache one Wallet instance per (offerId, arkServerUrl). Repeated open()
 * calls during a render would re-fetch info, re-bootstrap VTXO state,
 * and slow things down.
 */
const walletCache = new Map<string, Promise<Wallet>>();

function openWallet(
  pocWallet: PoCWallet,
  offerId: string,
  arkServerUrl: string,
  exitTimelock: { value: number; type: 'blocks' | 'seconds' },
): Promise<Wallet> {
  // Cache key includes the timelock — if the server changes its
  // override, we need a fresh Wallet instance whose internal address
  // matches the new payout VTXO shape.
  const cacheKey = `${arkServerUrl}|${offerId}|${exitTimelock.value}${exitTimelock.type}`;
  let cached = walletCache.get(cacheKey);
  if (!cached) {
    const { secretKey } = deriveTakeKey(pocWallet.seed, offerId);
    cached = Wallet.create({
      identity: SingleKey.fromPrivateKey(secretKey),
      arkServerUrl,
      exitTimelock: {
        value: BigInt(exitTimelock.value),
        type: exitTimelock.type,
      },
    });
    walletCache.set(cacheKey, cached);
  }
  return cached;
}
