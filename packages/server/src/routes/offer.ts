import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { hex } from '@scure/base';
import { EscrowVtxoScript } from '@satora/escrow';
import type {
  CreateOfferResponse,
  FundingStatus,
  RegisterEscrowResponse,
} from '@arkade-peach-escrow-poc/shared';
import { findContractForOffer, type Store } from '../store.js';
import type { ArkContext } from '../ark.js';
import type { PeachIdentity } from '../identity.js';

const CreateOfferBody = z.object({
  sellAmountSats: z.number().int().positive(),
});

const RegisterEscrowBody = z.object({
  sellerPubKey: z.string().regex(/^[0-9a-fA-F]{64}$/),
});

export interface OfferDeps {
  store: Store;
  ark: ArkContext;
  peach: PeachIdentity;
}

export function offerRouter(deps: OfferDeps): Router {
  const router = Router();
  const { store, ark, peach } = deps;

  router.post('/v1/offer', (req: Request, res: Response) => {
    const body = CreateOfferBody.parse(req.body);
    const id = randomUUID();
    store.offers.set(id, {
      id,
      sellAmountSats: body.sellAmountSats,
      status: 'PENDING_ESCROW',
      createdAt: Math.floor(Date.now() / 1000),
    });
    const response: CreateOfferResponse = { offerId: id };
    res.status(201).json(response);
  });

  router.post('/v1/offer/:id/escrow', (req: Request, res: Response) => {
    const offerId = req.params.id as string;
    const body = RegisterEscrowBody.parse(req.body);

    const offer = store.offers.get(offerId);
    if (!offer) {
      res.status(404).json({ error: 'offer not found' });
      return;
    }
    if (offer.status !== 'PENDING_ESCROW') {
      res.status(409).json({ error: `offer status is ${offer.status}` });
      return;
    }

    const sellerPk = hex.decode(body.sellerPubKey);
    const escrow = new EscrowVtxoScript({
      sellerPubKey: sellerPk,
      arbiterPubKey: peach.publicKey,
      aspPubKey: ark.aspPubKey,
      exitTimelock: ark.exitTimelock,
    });

    offer.sellerPubKeyHex = body.sellerPubKey;
    offer.escrowArkAddress = escrow.arkAddress(ark.network);
    offer.escrowPkScript = escrow.pkScript;
    offer.status = 'AWAITING_FUNDING';

    const response: RegisterEscrowResponse = {
      escrowVtxoArkAddress: offer.escrowArkAddress,
      arbiterPubKey: peach.publicKeyHex,
      aspPubKey: ark.aspPubKeyHex,
      csvTimelock: {
        value: Number(ark.exitTimelock.value),
        type: ark.exitTimelock.type,
      },
    };
    res.status(201).json(response);
  });

  router.get('/v1/offers', (_req: Request, res: Response) => {
    const offers = Array.from(store.offers.values())
      .filter((o) => o.status === 'FUNDED')
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100);
    res.json(
      offers.map((o) => ({
        offerId: o.id,
        sellAmountSats: o.sellAmountSats,
        status: o.status,
        escrowArkAddress: o.escrowArkAddress,
        createdAt: o.createdAt,
      })),
    );
  });

  router.get('/v1/offer/:id/funding', (req: Request, res: Response) => {
    const offerId = req.params.id as string;
    const offer = store.offers.get(offerId);
    if (!offer) {
      res.status(404).json({ error: 'offer not found' });
      return;
    }

    const contract = findContractForOffer(store, offerId);

    const isFunded =
      offer.status === 'FUNDED' ||
      offer.status === 'TAKEN' ||
      offer.status === 'RELEASED';

    const response: FundingStatus = {
      status: isFunded ? 'FUNDED' : 'PENDING',
      sellAmountSats: offer.sellAmountSats,
      ...(offer.fundingTxid !== undefined ? { fundingTxid: offer.fundingTxid } : {}),
      ...(offer.fundedAmountSats !== undefined
        ? { fundedAmountSats: offer.fundedAmountSats }
        : {}),
      ...(contract !== undefined ? { contractId: contract.id } : {}),
    };
    res.json(response);
  });

  return router;
}
