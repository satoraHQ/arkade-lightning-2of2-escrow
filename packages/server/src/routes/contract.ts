import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { hex, base64 } from '@scure/base';
import { schnorr } from '@noble/curves/secp256k1.js';
import {
  ArkAddress,
  DefaultVtxo,
  Transaction,
  combineTapscriptSigs,
} from '@arkade-os/sdk';
import { payoutCommitmentMessage } from '@satora/escrow';
import type {
  ContractStatus,
  TakeOfferResponse,
  ReleasePsbtResponse,
  SubmitSellerSigResponse,
} from '@arkade-peach-escrow-poc/shared';
import type { Store, Contract, Offer } from '../store.js';
import type { ArkContext } from '../ark.js';
import type { PeachIdentity } from '../identity.js';
import {
  buildReleaseTx,
  peachSignAll,
  submitAndFinalize,
  type BuiltRelease,
} from '../release.js';

const TakeOfferBody = z.object({
  amountSats: z.number().int().positive(),
  payoutArkAddress: z.string().min(10),
  buyerPubKey: z.string().regex(/^[0-9a-fA-F]{64}$/),
  payoutAddressSig: z.string().regex(/^[0-9a-fA-F]{128}$/),
});

const ReleaseSigBody = z.object({
  sellerSignedArkTxPsbtB64: z.string().min(1),
  sellerSignedCheckpointPsbtsB64: z.array(z.string().min(1)).min(1),
});

export interface ContractDeps {
  store: Store;
  ark: ArkContext;
  peach: PeachIdentity;
  feeBps: number;
  peachFeeArkAddress: string;
}

interface ContractWithOffer {
  contract: Contract;
  offer: Offer;
}

export function contractRouter(deps: ContractDeps): Router {
  const router = Router();
  const { store, ark, peach, feeBps, peachFeeArkAddress } = deps;

  const loadContract = (contractId: string): ContractWithOffer | undefined => {
    const contract = store.contracts.get(contractId);
    if (!contract) return undefined;
    const offer = store.offers.get(contract.offerId);
    if (!offer) return undefined;
    return { contract, offer };
  };

  router.post('/v1/offer/:id/take', (req: Request, res: Response) => {
    const offerId = req.params.id as string;
    const body = TakeOfferBody.parse(req.body);

    const offer = store.offers.get(offerId);
    if (!offer) {
      res.status(404).json({ error: 'offer not found' });
      return;
    }
    if (offer.status !== 'FUNDED') {
      res.status(409).json({ error: `offer status is ${offer.status}` });
      return;
    }

    const expectedFee = Math.floor((offer.sellAmountSats * feeBps) / 10_000);
    const expectedBuyer = offer.sellAmountSats - expectedFee;
    if (body.amountSats !== expectedBuyer) {
      res.status(400).json({
        error: `amountSats must be ${expectedBuyer} (sellAmount=${offer.sellAmountSats} feeBps=${feeBps})`,
      });
      return;
    }

    // Verify the buyer's payout-address commitment. The address must
    // be a DefaultVtxo built from (buyerPubKey, aspPubKey) — that's the
    // shape we'll spend to in the release ark-tx and the only one
    // Wallet.send can spend from afterwards.
    let parsedAddress: ArkAddress;
    try {
      parsedAddress = ArkAddress.decode(body.payoutArkAddress);
    } catch (err) {
      res.status(400).json({ error: 'invalid payoutArkAddress' });
      return;
    }
    const buyerPk = hex.decode(body.buyerPubKey);
    const expectedDefaultVtxo = new DefaultVtxo.Script({
      pubKey: buyerPk,
      serverPubKey: ark.aspPubKey,
      csvTimelock: ark.exitTimelock,
    });
    if (!bytesEqual(parsedAddress.vtxoTaprootKey, expectedDefaultVtxo.tweakedPublicKey)) {
      res.status(400).json({
        error:
          'payoutArkAddress is not a DefaultVtxo built from (buyerPubKey, aspPubKey)',
      });
      return;
    }
    if (!bytesEqual(parsedAddress.serverPubKey, ark.aspPubKey)) {
      res.status(400).json({
        error: 'payoutArkAddress embeds a different ASP pubkey',
      });
      return;
    }

    const msg = new TextEncoder().encode(
      payoutCommitmentMessage(offerId, body.payoutArkAddress),
    );
    const sigBytes = hex.decode(body.payoutAddressSig);
    if (!schnorr.verify(sigBytes, msg, buyerPk)) {
      res.status(400).json({ error: 'invalid payoutAddressSig' });
      return;
    }

    const contractId = randomUUID();
    store.contracts.set(contractId, {
      id: contractId,
      offerId,
      buyerPubKeyHex: body.buyerPubKey,
      buyerPayoutArkAddress: body.payoutArkAddress,
      buyerAmountSats: body.amountSats,
      payoutAddressSig: body.payoutAddressSig,
      status: 'PENDING_RELEASE',
      createdAt: Math.floor(Date.now() / 1000),
    });
    offer.status = 'TAKEN';

    const response: TakeOfferResponse = { contractId };
    res.status(201).json(response);
  });

  router.get('/v1/contract/:id', (req: Request, res: Response) => {
    const contractId = req.params.id as string;
    const found = loadContract(contractId);
    if (!found) {
      res.status(404).json({ error: 'contract not found' });
      return;
    }
    const response: ContractStatus = {
      contractId: found.contract.id,
      offerId: found.contract.offerId,
      status: found.offer.status as ContractStatus['status'],
      ...(found.contract.arkTxid !== undefined
        ? { arkTxid: found.contract.arkTxid }
        : {}),
    };
    res.json(response);
  });

  router.get(
    '/v1/contract/:id/release-psbt',
    (req: Request, res: Response) => {
      const contractId = req.params.id as string;
      const found = loadContract(contractId);
      if (!found) {
        res.status(404).json({ error: 'contract not found' });
        return;
      }
      const { contract, offer } = found;
      if (offer.status !== 'TAKEN') {
        res.status(409).json({
          error: `offer status is ${offer.status}, expected TAKEN`,
        });
        return;
      }
      if (
        !offer.fundingTxid ||
        offer.fundingVout === undefined ||
        offer.fundedAmountSats === undefined ||
        !offer.sellerPubKeyHex
      ) {
        res.status(409).json({ error: 'offer has no recorded funding' });
        return;
      }

      const built = buildReleaseTx(
        {
          sellerPubKey: hex.decode(offer.sellerPubKeyHex),
          funding: {
            txid: offer.fundingTxid,
            vout: offer.fundingVout,
            valueSats: offer.fundedAmountSats,
          },
          buyerArkAddress: contract.buyerPayoutArkAddress,
          buyerAmountSats: contract.buyerAmountSats,
          feeSats: offer.sellAmountSats - contract.buyerAmountSats,
          peachFeeArkAddress,
        },
        ark,
        peach,
      );
      peachSignAll(built, peach);

      const response: ReleasePsbtResponse = {
        arkTxPsbtB64: base64.encode(built.arkTx.toPSBT()),
        checkpointPsbtsB64: built.checkpoints.map((c) =>
          base64.encode(c.toPSBT()),
        ),
        expected: {
          escrowOutpoint: {
            txid: offer.fundingTxid,
            vout: offer.fundingVout,
          },
          buyerArkAddress: contract.buyerPayoutArkAddress,
          buyerAmountSats: contract.buyerAmountSats,
          feeArkAddress: peachFeeArkAddress,
          feeAmountSats: offer.sellAmountSats - contract.buyerAmountSats,
        },
      };
      res.json(response);
    },
  );

  router.post(
    '/v1/contract/:id/release-sig',
    async (req: Request, res: Response) => {
      const contractId = req.params.id as string;
      const body = ReleaseSigBody.parse(req.body);
      const found = loadContract(contractId);
      if (!found) {
        res.status(404).json({ error: 'contract not found' });
        return;
      }
      const { contract, offer } = found;

      if (offer.status === 'RELEASED' && contract.arkTxid) {
        const response: SubmitSellerSigResponse = { arkTxid: contract.arkTxid };
        res.json(response);
        return;
      }
      if (offer.status !== 'TAKEN') {
        res.status(409).json({
          error: `offer status is ${offer.status}, expected TAKEN`,
        });
        return;
      }
      if (
        !offer.fundingTxid ||
        offer.fundingVout === undefined ||
        offer.fundedAmountSats === undefined ||
        !offer.sellerPubKeyHex
      ) {
        res.status(409).json({ error: 'offer has no recorded funding' });
        return;
      }

      // Rebuild deterministically (originals stay unsigned for submitTx).
      const built = buildReleaseTx(
        {
          sellerPubKey: hex.decode(offer.sellerPubKeyHex),
          funding: {
            txid: offer.fundingTxid,
            vout: offer.fundingVout,
            valueSats: offer.fundedAmountSats,
          },
          buyerArkAddress: contract.buyerPayoutArkAddress,
          buyerAmountSats: contract.buyerAmountSats,
          feeSats: offer.sellAmountSats - contract.buyerAmountSats,
          peachFeeArkAddress,
        },
        ark,
        peach,
      );

      // Working copies that accumulate user (peach + seller) sigs. The
      // `built.arkTx`/`built.checkpoints` originals stay unsigned and are
      // what we send to submitTx. Peach signs the clones with the same
      // deterministic auxRand used in round 1 — otherwise the merge with
      // the seller's PSBT (which still carries round 1's peach sig)
      // would reject on conflicting values at the same (pk, leafHash).
      const userBuilt: BuiltRelease = {
        arkTx: Transaction.fromPSBT(built.arkTx.toPSBT()),
        checkpoints: built.checkpoints.map((c) =>
          Transaction.fromPSBT(c.toPSBT()),
        ),
      };
      peachSignAll(userBuilt, peach);
      const peachArkTx = userBuilt.arkTx;
      const peachCheckpoints = userBuilt.checkpoints;

      // Merge seller's tap_script_sigs into our peach-signed clones.
      const sellerArkTx = Transaction.fromPSBT(
        base64.decode(body.sellerSignedArkTxPsbtB64),
      );
      combineTapscriptSigs(sellerArkTx, peachArkTx);

      if (
        body.sellerSignedCheckpointPsbtsB64.length !== peachCheckpoints.length
      ) {
        res.status(400).json({
          error: `expected ${peachCheckpoints.length} signed checkpoint PSBT(s), got ${body.sellerSignedCheckpointPsbtsB64.length}`,
        });
        return;
      }
      for (let i = 0; i < peachCheckpoints.length; i++) {
        const sellerCp = Transaction.fromPSBT(
          base64.decode(body.sellerSignedCheckpointPsbtsB64[i]!),
        );
        combineTapscriptSigs(sellerCp, peachCheckpoints[i]!);
      }

      try {
        const arkTxid = await submitAndFinalize(
          ark,
          peachArkTx,
          peachCheckpoints,
          built.checkpoints,
        );

        contract.arkTxid = arkTxid;
        contract.status = 'RELEASED';
        offer.status = 'RELEASED';

        const response: SubmitSellerSigResponse = { arkTxid };
        res.json(response);
      } catch (err) {
        console.error(`[release] submit/finalize failed for ${contractId}:`, err);
        res.status(502).json({
          error: 'asp_submit_failed',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  return router;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
