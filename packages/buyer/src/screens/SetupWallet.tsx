import { useState } from 'react';
import { clearWallet, type Wallet } from '../wallet.js';

export function SetupWallet({
  wallet,
  onContinue,
}: {
  wallet: Wallet;
  onContinue: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="card">
      <h2>Wallet</h2>
      <p className="muted">
        32-byte random seed, unencrypted, kept in a local file (and mirrored to
        localStorage) so it survives clearing browser data. Per-take keys are
        derived deterministically.
      </p>
      <div className="row">
        <button onClick={() => setRevealed(!revealed)}>
          {revealed ? 'hide' : 'reveal'} seed
        </button>
        <button
          onClick={async () => {
            if (confirm('Clear the wallet? Any active escrows will become unrecoverable.')) {
              await clearWallet();
              location.reload();
            }
          }}
        >
          clear
        </button>
        <button className="primary" onClick={onContinue}>
          continue
        </button>
      </div>
      {revealed ? <pre className="mono">{wallet.seedHex}</pre> : null}
    </div>
  );
}
