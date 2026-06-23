import { useEffect, useState } from 'react';
import type {
  ContractStatus,
  OfferSummary,
} from '@arkade-peach-escrow-poc/shared';
import { loadOrCreateWallet } from './wallet.js';
import { api } from './api.js';
import { SetupWallet } from './screens/SetupWallet.js';
import { BrowseOffers } from './screens/BrowseOffers.js';
import { TakeOffer } from './screens/TakeOffer.js';
import { AwaitRelease } from './screens/AwaitRelease.js';
import { Withdraw } from './screens/Withdraw.js';
import { configureExplorers } from './explorer.js';

type Step = 'wallet' | 'browse' | 'take' | 'await' | 'withdraw';

const FEE_BPS = 10;

export function App() {
  const [wallet] = useState(() => loadOrCreateWallet());
  const [step, setStep] = useState<Step>('wallet');
  const [offer, setOffer] = useState<OfferSummary | null>(null);
  const [contractId, setContractId] = useState<string | null>(null);
  const [contract, setContract] = useState<ContractStatus | null>(null);
  const [aspPubKey, setAspPubKey] = useState<string | null>(null);
  const [arkServerUrl, setArkServerUrl] = useState<string | null>(null);
  const [satoraApiUrl, setSatoraApiUrl] = useState<string | null>(null);
  const [hrp, setHrp] = useState<string | null>(null);
  const [exitTimelock, setExitTimelock] = useState<{
    value: number;
    type: 'blocks' | 'seconds';
  } | null>(null);

  useEffect(() => {
    api
      .health()
      .then((h) => {
        setAspPubKey(h.aspPubKey);
        setArkServerUrl(h.arkServerUrl);
        setSatoraApiUrl(h.satoraApiUrl);
        setHrp(h.hrp);
        setExitTimelock(h.exitTimelock);
        configureExplorers({ ark: h.arkExplorerUrl, l1: h.l1ExplorerUrl });
      })
      .catch((e) => console.error('[buyer] healthz failed:', e));
  }, []);

  return (
    <div className="app">
      <h1>Peach Escrow PoC — Buyer</h1>
      <div className="banner-warn">
        PoC ONLY. Mutinynet/signet. Keys live unencrypted in localStorage.
        Do not use with real funds.
      </div>

      <ol className="steps">
        <li className={cls(step, 'wallet')}>1. wallet</li>
        <li className={cls(step, 'browse')}>2. browse offers</li>
        <li className={cls(step, 'take')}>3. take</li>
        <li className={cls(step, 'await')}>4. await release</li>
        <li className={cls(step, 'withdraw')}>5. withdraw</li>
      </ol>

      {step === 'wallet' ? (
        <SetupWallet wallet={wallet} onContinue={() => setStep('browse')} />
      ) : null}

      {step === 'browse' ? (
        <BrowseOffers
          onPick={(o) => {
            setOffer(o);
            setStep('take');
          }}
        />
      ) : null}

      {step === 'take' && offer && aspPubKey && hrp && exitTimelock ? (
        <TakeOffer
          wallet={wallet}
          offer={offer}
          feeBps={FEE_BPS}
          aspPubKeyHex={aspPubKey}
          hrp={hrp}
          exitTimelock={exitTimelock}
          onTaken={(id) => {
            setContractId(id);
            setStep('await');
          }}
        />
      ) : null}

      {step === 'take' && (!offer || !aspPubKey || !hrp || !exitTimelock) ? (
        <div className="card">
          <p className="muted">
            Loading ASP config from {`{server}`}/healthz...
          </p>
        </div>
      ) : null}

      {step === 'await' && contractId ? (
        <AwaitRelease
          contractId={contractId}
          onReleased={(s) => {
            setContract(s);
            setStep('withdraw');
          }}
        />
      ) : null}

      {step === 'withdraw' &&
      contract &&
      arkServerUrl &&
      satoraApiUrl &&
      exitTimelock ? (
        <Withdraw
          wallet={wallet}
          offerId={contract.offerId}
          arkServerUrl={arkServerUrl}
          satoraApiUrl={satoraApiUrl}
          exitTimelock={exitTimelock}
          status={contract}
        />
      ) : null}
    </div>
  );
}

function cls(current: Step, target: Step): string {
  const order: Step[] = ['wallet', 'browse', 'take', 'await', 'withdraw'];
  const ci = order.indexOf(current);
  const ti = order.indexOf(target);
  if (ci === ti) return 'active';
  if (ci > ti) return 'done';
  return '';
}
