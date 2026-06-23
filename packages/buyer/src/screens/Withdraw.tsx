import { useEffect, useState } from 'react';
import { SingleKey, Wallet } from '@arkade-os/sdk';
import {
  classifyDestination,
  type WithdrawResult,
} from '@satora/escrow-client';
import type { ContractStatus } from '@arkade-peach-escrow-poc/shared';
import { deriveTakeKey, type Wallet as PoCWallet } from '../wallet.js';
import { getEscrowClient } from '../escrow.js';
import { ExplorerTx, L1ExplorerTx } from '../explorer.js';
import { CopyButton, middleEllipsis } from '../ui.js';

const KIND_LABEL = {
  lightning: 'Lightning',
  arkade: 'Arkade',
  l1: 'onchain (L1)',
} as const;

/**
 * Once the release ark-tx is broadcast, the buyer's payout VTXO is spendable.
 * This screen withdraws the full payout via the escrow-client's smart
 * `withdraw`, which auto-routes by the destination string:
 *
 *   - BOLT11 / LNURL / user@host → Arkade→Lightning swap
 *   - ark1… / tark1…             → offchain Ark transfer
 *   - bc1… / tb1… / 1…           → L1 collaborative offboard
 *
 * For the PoC we instantiate an @arkade-os/sdk Wallet on the fly with the
 * buyer's per-take key (in-memory storage; the seed in localStorage rebuilds
 * everything on next load) and hand it to the escrow-client.
 *
 * The amount is always the full payout: for Arkade we send the balance, for
 * Lightning the recipient amount comes from the SDK quote (payout minus the
 * swap fee; a BOLT11 invoice uses its own amount), and for L1 we offboard
 * everything. So there is no amount field.
 */
export function Withdraw({
  wallet: pocWallet,
  offerId,
  arkServerUrl,
  satoraApiUrl,
  exitTimelock,
  status,
}: {
  wallet: PoCWallet;
  offerId: string;
  arkServerUrl: string;
  satoraApiUrl: string;
  exitTimelock: { value: number; type: 'blocks' | 'seconds' };
  status: ContractStatus;
}) {
  const [destination, setDestination] = useState('');
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<WithdrawResult | null>(null);
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

  const trimmed = destination.trim();
  const kind = trimmed ? classifyDestination(trimmed) : null;

  async function withdraw() {
    setWorking(true);
    setErr(null);
    setResult(null);
    setProgress('opening wallet…');
    try {
      const sdk = await openWallet(pocWallet, offerId, arkServerUrl, exitTimelock);
      const escrowClient = await getEscrowClient(satoraApiUrl, arkServerUrl);
      const availableSats = Number((await sdk.getBalance()).available ?? 0);

      // Resolve the amount for a full-payout withdrawal. L1 offboards everything
      // (amount omitted); Arkade sends the whole balance; Lightning sends the
      // quoted recipient amount (ignored by the SDK for a BOLT11 invoice).
      let amountSats: number | undefined;
      if (kind === 'arkade') {
        amountSats = availableSats;
      } else if (kind === 'lightning') {
        setProgress('quoting…');
        amountSats = (await escrowClient.quoteLightningWithdrawal(availableSats))
          .recipientSats;
      }

      setProgress(`withdrawing to ${kind ? KIND_LABEL[kind] : 'destination'}…`);
      const res = await escrowClient.withdraw({
        wallet: sdk,
        destination: trimmed,
        amountSats,
      });
      setResult(res);
      setProgress(null);
    } catch (e) {
      setErr(String(e));
      setProgress(null);
    } finally {
      setWorking(false);
    }
  }

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

      <div className="field">
        <div className="field-label">
          destination
          {kind ? <span className="badge"> → {KIND_LABEL[kind]}</span> : null}
        </div>
        <input
          value={destination}
          placeholder="lnbc… · lnurl1… · user@host · ark1… · bc1…"
          onChange={(e) => setDestination(e.target.value)}
        />
      </div>
      <p className="muted">
        Withdraws your full payout to whatever you paste — Lightning
        (invoice/LNURL/address), an Arkade address, or an onchain address. The
        amount is set automatically (a BOLT11 invoice uses its own).
      </p>

      <div className="row">
        <button
          className="primary"
          onClick={withdraw}
          disabled={working || !trimmed}
        >
          {working
            ? 'withdrawing…'
            : `withdraw${kind ? ` to ${KIND_LABEL[kind]}` : ''}`}
        </button>
      </div>

      {progress ? <p className="muted">{progress}</p> : null}

      {result ? (
        <>
          <div className="status-row">
            <span className="badge badge-ok">{resultBadge(result)}</span>
          </div>
          <div className="field">
            <div className="field-label">{resultTxLabel(result)}</div>
            <div className="field-row">
              <span className="field-value">
                {result.method === 'l1' ? (
                  <L1ExplorerTx txid={result.txid}>
                    {middleEllipsis(result.txid, 14, 12)}
                  </L1ExplorerTx>
                ) : (
                  <ExplorerTx txid={result.txid}>
                    {middleEllipsis(result.txid, 14, 12)}
                  </ExplorerTx>
                )}
              </span>
              <CopyButton value={result.txid} />
            </div>
          </div>
        </>
      ) : null}

      {err ? <p className="error">{err}</p> : null}
    </div>
  );
}

function resultBadge(result: WithdrawResult): string {
  switch (result.method) {
    case 'lightning':
      return `paid via Lightning · ${result.sourceAmountSats} sats`;
    case 'arkade':
      return 'sent on Arkade';
    case 'l1':
      return 'withdrawn to L1';
  }
}

function resultTxLabel(result: WithdrawResult): string {
  switch (result.method) {
    case 'lightning':
      return 'VHTLC funding (ark-tx)';
    case 'arkade':
      return 'ark-tx';
    case 'l1':
      return 'settlement txid (L1)';
  }
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
