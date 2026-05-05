import { useEffect, useState } from 'react';
import type { OfferSummary } from '@arkade-peach-escrow-poc/shared';
import { api } from '../api.js';

export function BrowseOffers({
  onPick,
}: {
  onPick: (offer: OfferSummary) => void;
}) {
  const [offers, setOffers] = useState<OfferSummary[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      setOffers(await api.listOffers());
    } catch (e) {
      setErr(String(e));
    }
  }

  useEffect(() => {
    void load();
    const handle = setInterval(load, 5000);
    return () => clearInterval(handle);
  }, []);

  return (
    <div className="card">
      <h2>Browse offers</h2>
      <button onClick={() => void load()}>refresh</button>
      {err ? <p style={{ color: 'crimson' }}>{err}</p> : null}
      {offers.length === 0 ? (
        <p className="muted">No funded offers yet.</p>
      ) : (
        offers.map((o) => (
          <div key={o.offerId} className="card">
            <div>
              <strong>{o.sellAmountSats}</strong> sats
            </div>
            <div className="muted mono">offer {o.offerId}</div>
            <button className="primary" onClick={() => onPick(o)}>
              take
            </button>
          </div>
        ))
      )}
    </div>
  );
}
