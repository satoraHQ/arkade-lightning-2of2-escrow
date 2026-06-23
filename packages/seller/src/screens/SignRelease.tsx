import { useEffect, useState } from 'react';
import { ArkAddress, P2A, Transaction } from '@arkade-os/sdk';
import { base64, hex } from '@scure/base';
import {
  signEscrowArkTx,
  signEscrowCheckpoints,
  verifyReleaseArkTx,
} from '@satora/escrow';
import type {
  FundingStatus,
  RegisterEscrowResponse,
} from '@arkade-peach-escrow-poc/shared';
import { api } from '../api.js';
import { deriveOfferKey, type Wallet } from '../wallet.js';
import { ExplorerAddress, ExplorerTx } from '../explorer.js';

/**
 * Seller-side check for a no-fee cooperative release (single buyer output).
 * Mirrors the SDK's `verifyReleaseArkTx` but expects exactly one buyer output
 * plus the P2A anchor — no fee output. Throws on any mismatch; caller must NOT
 * sign if this throws.
 */
function verifyBuyerOnlyRelease(
  release: { arkTx: Transaction; checkpoints: Transaction[] },
  expected: {
    escrowOutpoint: { txid: string; vout: number };
    buyerArkAddress: string;
    buyerAmountSats: bigint;
  },
): void {
  const { arkTx, checkpoints } = release;
  if (checkpoints.length !== 1) {
    throw new Error(`expected exactly 1 checkpoint, got ${checkpoints.length}`);
  }
  const checkpoint = checkpoints[0]!;
  const cpIn = checkpoint.getInput(0);
  if (!cpIn.txid || cpIn.index === undefined) {
    throw new Error('checkpoint input 0 missing prevout');
  }
  if (
    hex.encode(cpIn.txid) !== expected.escrowOutpoint.txid ||
    cpIn.index !== expected.escrowOutpoint.vout
  ) {
    throw new Error('checkpoint does not spend the escrow funding outpoint');
  }
  if (arkTx.inputsLength !== 1) {
    throw new Error(`expected exactly 1 ark-tx input, got ${arkTx.inputsLength}`);
  }
  const arkIn = arkTx.getInput(0);
  if (!arkIn.txid || hex.encode(arkIn.txid) !== checkpoint.id) {
    throw new Error('ark-tx does not spend the checkpoint');
  }
  const buyer = ArkAddress.decode(expected.buyerArkAddress);
  const anchorScriptHex = hex.encode(P2A.script);
  let buyerOutputs = 0;
  let anchorOutputs = 0;
  for (let i = 0; i < arkTx.outputsLength; i++) {
    const output = arkTx.getOutput(i);
    if (!output.script || output.amount === undefined) {
      throw new Error(`ark-tx output ${i} missing script or amount`);
    }
    if (
      matchesAddress(output.script, buyer) &&
      output.amount === expected.buyerAmountSats
    ) {
      buyerOutputs++;
    } else if (
      hex.encode(output.script) === anchorScriptHex &&
      output.amount === P2A.amount
    ) {
      anchorOutputs++;
    } else {
      throw new Error(
        `unexpected ark-tx output ${i}: ${output.amount} sats to ${hex.encode(output.script)}`,
      );
    }
  }
  if (buyerOutputs !== 1) {
    throw new Error(
      `expected exactly 1 buyer output paying ${expected.buyerAmountSats} sats, got ${buyerOutputs}`,
    );
  }
  if (anchorOutputs !== 1) {
    throw new Error(`expected exactly 1 P2A anchor output, got ${anchorOutputs}`);
  }
}

function matchesAddress(
  script: Uint8Array,
  address: { pkScript: Uint8Array; subdustPkScript: Uint8Array },
): boolean {
  return (
    bytesEqual(script, address.pkScript) ||
    bytesEqual(script, address.subdustPkScript)
  );
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Poll the funding endpoint until a buyer has taken the offer
 * (`contractId` materialises), then let the seller sign the cooperative
 * release ark-tx. The actual sign + submit + finalize lives server-side
 * in `release-sig`.
 */
export function SignRelease({
  wallet,
  offerId,
  escrow,
  funding,
  arkTxid: persistedArkTxid,
  onReleased,
  onStartOver,
}: {
  wallet: Wallet;
  offerId: string;
  escrow: RegisterEscrowResponse;
  funding: FundingStatus | null;
  arkTxid: string | null;
  onReleased: (arkTxid: string) => void;
  onStartOver: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [arkTxid, setArkTxid] = useState<string | null>(persistedArkTxid);
  const [err, setErr] = useState<string | null>(null);
  const [contractId, setContractId] = useState<string | null>(null);

  // Poll until a buyer takes the offer.
  useEffect(() => {
    if (contractId || arkTxid) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const status = await api.funding(offerId);
        if (cancelled) return;
        if (status.contractId) setContractId(status.contractId);
      } catch (e) {
        console.error('[release] funding poll failed:', e);
      }
    };
    void tick();
    const handle = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [offerId, contractId, arkTxid]);

  async function release() {
    if (!contractId) return;
    setWorking(true);
    setErr(null);
    try {
      const psbts = await api.releasePsbt(contractId);

      // Verify the release pays the agreed outputs before signing. The SDK's
      // verifyReleaseArkTx requires a fee output, so the no-fee release (fee
      // rounded to 0) uses a local single-output check.
      const arkTx = Transaction.fromPSBT(base64.decode(psbts.arkTxPsbtB64));
      const checkpoints = psbts.checkpointPsbtsB64.map((c) =>
        Transaction.fromPSBT(base64.decode(c)),
      );
      const { expected } = psbts;
      if (expected.feeArkAddress && expected.feeAmountSats) {
        verifyReleaseArkTx(
          { arkTx, checkpoints },
          {
            escrowOutpoint: expected.escrowOutpoint,
            buyerArkAddress: expected.buyerArkAddress,
            buyerAmountSats: BigInt(expected.buyerAmountSats),
            feeArkAddress: expected.feeArkAddress,
            feeAmountSats: BigInt(expected.feeAmountSats),
          },
        );
      } else {
        verifyBuyerOnlyRelease(
          { arkTx, checkpoints },
          {
            escrowOutpoint: expected.escrowOutpoint,
            buyerArkAddress: expected.buyerArkAddress,
            buyerAmountSats: BigInt(expected.buyerAmountSats),
          },
        );
      }

      const { secretKey } = deriveOfferKey(wallet.seed, offerId);
      const sellerSignedArkTx = signEscrowArkTx(
        psbts.arkTxPsbtB64,
        secretKey,
      ).signedPsbt;
      const sellerSignedCheckpoints = signEscrowCheckpoints(
        psbts.checkpointPsbtsB64,
        secretKey,
      );
      const { arkTxid: txid } = await api.releaseSig(contractId, {
        sellerSignedArkTxPsbtB64: sellerSignedArkTx,
        sellerSignedCheckpointPsbtsB64: sellerSignedCheckpoints,
      });
      setArkTxid(txid);
      onReleased(txid);
    } catch (e) {
      setErr(String(e));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="card">
      <h2>Buyer paid fiat → release sats</h2>

      <dl className="kv">
        <dt>offer</dt>
        <dd className="mono">{offerId}</dd>

        <dt>escrow address</dt>
        <dd>
          <ExplorerAddress address={escrow.escrowVtxoArkAddress} />
        </dd>

        {funding?.fundingTxid ? (
          <>
            <dt>funding</dt>
            <dd>
              <ExplorerTx txid={funding.fundingTxid} />
              {funding.fundedAmountSats !== undefined ? (
                <span className="muted"> &middot; {funding.fundedAmountSats} sats</span>
              ) : null}
            </dd>
          </>
        ) : null}

        <dt>arbiter pubkey</dt>
        <dd className="mono">{escrow.arbiterPubKey}</dd>

        <dt>asp pubkey</dt>
        <dd className="mono">{escrow.aspPubKey}</dd>

        <dt>exit timelock</dt>
        <dd>
          {escrow.csvTimelock.value} {escrow.csvTimelock.type}
        </dd>

        {contractId ? (
          <>
            <dt>contract</dt>
            <dd className="mono">{contractId}</dd>
          </>
        ) : null}

        {arkTxid ? (
          <>
            <dt>release ark-tx</dt>
            <dd>
              <ExplorerTx txid={arkTxid} />
            </dd>
          </>
        ) : null}
      </dl>

      {!contractId && !arkTxid ? (
        <p className="muted">Waiting for a buyer to take the offer…</p>
      ) : null}

      {contractId && !arkTxid ? (
        <button className="primary" disabled={working} onClick={release}>
          {working ? 'signing…' : 'release'}
        </button>
      ) : null}

      {arkTxid ? (
        <div className="row">
          <span className="muted">released — sats are now with the buyer.</span>
          <button onClick={onStartOver}>start a new offer</button>
        </div>
      ) : null}

      {err ? <p style={{ color: 'crimson' }}>{err}</p> : null}
    </div>
  );
}
