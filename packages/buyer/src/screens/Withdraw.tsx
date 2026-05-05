import { useEffect, useState } from 'react';
import { Ramps, SingleKey, Wallet } from '@arkade-os/sdk';
import type { ContractStatus } from '@arkade-peach-escrow-poc/shared';
import { deriveTakeKey, type Wallet as PoCWallet } from '../wallet.js';
import { ExplorerTx, L1ExplorerTx } from '../explorer.js';

/**
 * Once the release ark-tx is broadcast, the buyer's payout VTXO is
 * spendable. This screen runs the canonical Arkade collaborative-exit
 * flow via Ramps.offboard, settling the VTXO out to an L1 bech32
 * address.
 *
 * For the PoC we instantiate an @arkade-os/sdk Wallet on the fly with
 * the buyer's per-take key as its SingleKey identity. Storage is
 * in-memory (we don't persist between sessions — the seed in
 * localStorage rebuilds everything on next load).
 */
export function Withdraw({
  wallet: pocWallet,
  offerId,
  arkServerUrl,
  exitTimelock,
  status,
}: {
  wallet: PoCWallet;
  offerId: string;
  arkServerUrl: string;
  exitTimelock: { value: number; type: 'blocks' | 'seconds' };
  status: ContractStatus;
}) {
  const [destination, setDestination] = useState('');
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [arkTxid, setArkTxid] = useState<string | null>(null);
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

  async function withdraw() {
    setWorking(true);
    setErr(null);
    setArkTxid(null);
    setProgress('opening wallet…');
    try {
      const sdk = await openWallet(pocWallet, offerId, arkServerUrl, exitTimelock);
      setProgress('fetching fee info…');
      const info = await sdk.arkProvider.getInfo();
      const feeInfo = info.fees;

      setProgress('joining settlement round (this can take a minute)…');
      const ramps = new Ramps(sdk);
      const txid = await ramps.offboard(destination, feeInfo, undefined, (event) => {
        setProgress(`settlement: ${event.type}`);
      });

      setArkTxid(txid);
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
      <h2>Withdraw onchain</h2>
      {status.arkTxid ? (
        <p>
          sats released (ark-tx): <ExplorerTx txid={status.arkTxid} />
        </p>
      ) : null}
      {balance ? (
        <p>
          available in payout VTXO: <strong>{balance.available.toString()}</strong> sats
        </p>
      ) : (
        <p className="muted">loading balance…</p>
      )}
      <div className="row">
        <label>L1 destination (bech32)</label>
        <input
          value={destination}
          placeholder="tb1q…"
          onChange={(e) => setDestination(e.target.value)}
        />
      </div>
      <div className="row">
        <button
          className="primary"
          onClick={withdraw}
          disabled={working || !destination}
        >
          withdraw
        </button>
      </div>
      {progress ? <p className="muted">{progress}</p> : null}
      {arkTxid ? (
        <p>
          settlement txid (L1): <L1ExplorerTx txid={arkTxid} />
        </p>
      ) : null}
      {err ? <p style={{ color: 'crimson' }}>{err}</p> : null}
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
