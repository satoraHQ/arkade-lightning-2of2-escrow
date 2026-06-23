import { useEffect, useState } from 'react';
import { loadOrCreateWallet } from './wallet.js';
import { api } from './api.js';
import { SetupWallet } from './screens/SetupWallet.js';
import { CreateOffer } from './screens/CreateOffer.js';
import { FundOffer } from './screens/FundOffer.js';
import { SignRelease } from './screens/SignRelease.js';
import { configureExplorers } from './explorer.js';
import {
  EMPTY_SESSION,
  clearSession,
  loadSession,
  saveSession,
  type SellerStep,
} from './session.js';

type Step = SellerStep;

export function App() {
  const [wallet] = useState(() => loadOrCreateWallet());
  const [session, setSession] = useState(() => loadSession() ?? EMPTY_SESSION);

  useEffect(() => {
    saveSession(session);
  }, [session]);

  // The session is persisted in localStorage but the server's DB can be
  // wiped between runs (just reset-server). On boot, if our offerId
  // doesn't exist server-side anymore, drop the stale session so the
  // seller doesn't try to register an escrow against a missing offer.
  // Also backfill sellAmountSats for sessions saved before that field
  // existed.
  useEffect(() => {
    if (!session.offerId) return;
    let cancelled = false;
    void api
      .funding(session.offerId)
      .then((status) => {
        if (cancelled) return;
        setSession((s) =>
          s.sellAmountSats === null
            ? { ...s, sellAmountSats: status.sellAmountSats }
            : s,
        );
      })
      .catch((err) => {
        if (cancelled) return;
        if (String(err).includes('404')) {
          console.warn(
            `[seller] saved offer ${session.offerId} not on server, clearing session`,
          );
          clearSession();
          setSession({ ...EMPTY_SESSION, step: 'create' });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { step, offerId, sellAmountSats, escrow, funding } = session;
  const setStep = (next: Step) => setSession((s) => ({ ...s, step: next }));

  // Pull satoraApiUrl + arkServerUrl from server's healthz so the
  // FundOffer screen can build the swap client and the Ark providers.
  const [satoraApiUrl, setSatoraApiUrl] = useState<string | null>(null);
  const [arkServerUrl, setArkServerUrl] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  useEffect(() => {
    api
      .health()
      .then((h) => {
        setSatoraApiUrl(h.satoraApiUrl);
        setArkServerUrl(h.arkServerUrl);
        setNetwork(h.network);
        configureExplorers({ ark: h.arkExplorerUrl });
      })
      .catch((e) => console.error('[seller] healthz failed:', e));
  }, []);

  return (
    <div className="app">
      <h1>Peach Escrow PoC — Seller</h1>
      <div className="banner-warn">
        PoC ONLY. {networkLabel(network)}. Keys live unencrypted in
        localStorage. Do not use with real funds.
      </div>

      <ol className="steps">
        <li className={cls(step, 'wallet')}>1. wallet</li>
        <li className={cls(step, 'create')}>2. create offer</li>
        <li className={cls(step, 'fund')}>3. fund via LN</li>
        <li className={cls(step, 'release')}>4. sign release</li>
      </ol>

      {step === 'wallet' ? (
        <SetupWallet
          wallet={wallet}
          onContinue={() => setStep('create')}
          onClearSession={() => {
            clearSession();
            setSession(EMPTY_SESSION);
          }}
        />
      ) : null}

      {step === 'create' ? (
        <CreateOffer
          wallet={wallet}
          onCreated={(id, amount, escrowResponse) =>
            setSession((s) => ({
              ...s,
              offerId: id,
              sellAmountSats: amount,
              escrow: escrowResponse,
              step: 'fund',
            }))
          }
        />
      ) : null}

      {step === 'fund' && offerId && escrow && sellAmountSats !== null ? (
        <FundOffer
          wallet={wallet}
          offerId={offerId}
          escrow={escrow}
          amountSats={sellAmountSats}
          satoraApiUrl={satoraApiUrl}
          arkServerUrl={arkServerUrl}
          swapId={session.lnSwapId}
          invoice={session.lnInvoice}
          onSwap={(swapId, invoice) =>
            setSession((s) => ({ ...s, lnSwapId: swapId, lnInvoice: invoice }))
          }
          onFunded={(f) =>
            setSession((s) => ({ ...s, funding: f, step: 'release' }))
          }
        />
      ) : null}

      {step === 'release' && offerId && escrow ? (
        <SignRelease
          wallet={wallet}
          offerId={offerId}
          escrow={escrow}
          funding={funding}
          arkTxid={session.arkTxid}
          onReleased={(arkTxid) => setSession((s) => ({ ...s, arkTxid }))}
          onStartOver={() => {
            clearSession();
            setSession({ ...EMPTY_SESSION, step: 'create' });
          }}
        />
      ) : null}
    </div>
  );
}

function cls(current: Step, target: Step): string {
  const order: Step[] = ['wallet', 'create', 'fund', 'release'];
  const ci = order.indexOf(current);
  const ti = order.indexOf(target);
  if (ci === ti) return 'active';
  if (ci > ti) return 'done';
  return '';
}

// Human label for the /healthz network name (`bitcoin` is mainnet).
function networkLabel(network: string | null): string {
  if (network === null) return 'connecting…';
  return network === 'bitcoin' ? 'MAINNET' : network;
}
