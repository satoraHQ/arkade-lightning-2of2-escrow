import { useState } from 'react';
import { clearWallet, type Wallet } from '../wallet.js';

export function SetupWallet({
  wallet,
  onContinue,
  onClearSession,
}: {
  wallet: Wallet;
  onContinue: () => void;
  onClearSession: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="card">
      <h2>Wallet</h2>
      <p className="muted">
        A 32-byte random seed is stored unencrypted in localStorage.
        Per-offer Schnorr keys are derived from it via HKDF. No backup —
        clearing browser data orphans every active escrow.
      </p>
      <div className="row">
        <button onClick={() => setRevealed(!revealed)}>
          {revealed ? 'hide' : 'reveal'} seed
        </button>
        <button
          onClick={() => {
            if (confirm('Clear the wallet? Any active escrows will become unrecoverable.')) {
              clearWallet();
              onClearSession();
              location.reload();
            }
          }}
        >
          clear
        </button>
        <button onClick={() => {
          if (confirm('Forget the current offer and start over?')) {
            onClearSession();
          }
        }}>
          reset offer
        </button>
        <button className="primary" onClick={onContinue}>
          continue
        </button>
      </div>
      {revealed ? <pre className="mono">{wallet.seedHex}</pre> : null}
    </div>
  );
}
