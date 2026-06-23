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
        A 32-byte random seed, stored unencrypted in a local file (and
        mirrored to localStorage) so it survives clearing browser data.
        Per-offer Schnorr keys are derived from it via HKDF.
      </p>
      <div className="row">
        <button onClick={() => setRevealed(!revealed)}>
          {revealed ? 'hide' : 'reveal'} seed
        </button>
        <button
          onClick={async () => {
            if (confirm('Clear the wallet? Any active escrows will become unrecoverable.')) {
              await clearWallet();
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
