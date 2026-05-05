import { useEffect, useState } from 'react';
import type { ContractStatus } from '@arkade-peach-escrow-poc/shared';
import { api } from '../api.js';

export function AwaitRelease({
  contractId,
  onReleased,
}: {
  contractId: string;
  onReleased: (status: ContractStatus) => void;
}) {
  const [status, setStatus] = useState<ContractStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await api.contract(contractId);
        if (cancelled) return;
        setStatus(next);
        if (next.status === 'RELEASED' && next.arkTxid) onReleased(next);
      } catch (err) {
        console.error(err);
      }
    };
    void tick();
    const handle = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [contractId, onReleased]);

  return (
    <div className="card">
      <h2>Awaiting release</h2>
      <p className="muted">
        Mark the fiat as paid in your usual channel, then ping the seller
        to release the sats. The seller will sign the cooperative leaf and
        the server will broadcast.
      </p>
      <p>
        contract: <span className="mono">{contractId}</span>
      </p>
      <p>
        status: <strong>{status?.status ?? '...'}</strong>
      </p>
      {status?.arkTxid ? (
        <p>arkTxid: <span className="mono">{status.arkTxid}</span></p>
      ) : null}
    </div>
  );
}
