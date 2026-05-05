/**
 * In-memory store for the Peach-style server. State lives entirely in
 * Maps and is lost on restart. Fine for a PoC; for anything real you'd
 * swap this for sqlite/postgres and reuse the same shape.
 *
 * `sellAmountSats` vs `fundedAmountSats`:
 *   - `sellAmountSats`   — the offer parameter, set on insert. What the
 *                          seller *said* they'd sell. Used pre-funding
 *                          to size the LN swap and validate that the
 *                          buyer's take amount is sell - fee.
 *   - `fundedAmountSats` — what the polling worker actually observed at
 *                          the escrow address (sum of unspent VTXOs).
 *                          Used at release time as the PSBT input's
 *                          witnessUtxo.amount; must match the on-chain
 *                          truth or the ASP rejects the spend.
 *   In the happy path they're equal; they diverge only if the seller
 *   funded a different amount than offered.
 */

export type OfferStatus =
  | 'PENDING_ESCROW'
  | 'AWAITING_FUNDING'
  | 'FUNDED'
  | 'TAKEN'
  | 'RELEASED'
  | 'CANCELLED'
  | 'EXPIRED';

export interface Offer {
  id: string;
  sellAmountSats: number;
  status: OfferStatus;
  sellerPubKeyHex?: string;
  escrowArkAddress?: string;
  escrowPkScript?: Uint8Array;
  fundingTxid?: string;
  fundingVout?: number;
  fundedAmountSats?: number;
  createdAt: number;
}

export type ContractStatus = 'PENDING_RELEASE' | 'RELEASED' | 'CANCELLED';

export interface Contract {
  id: string;
  offerId: string;
  buyerPubKeyHex: string;
  buyerPayoutArkAddress: string;
  buyerAmountSats: number;
  payoutAddressSig: string;
  arkTxid?: string;
  status: ContractStatus;
  createdAt: number;
}

export interface Store {
  offers: Map<string, Offer>;
  contracts: Map<string, Contract>;
}

export function createStore(): Store {
  return {
    offers: new Map(),
    contracts: new Map(),
  };
}

/** Find the latest contract attached to an offer, if any. */
export function findContractForOffer(
  store: Store,
  offerId: string,
): Contract | undefined {
  let latest: Contract | undefined;
  for (const c of store.contracts.values()) {
    if (c.offerId !== offerId) continue;
    if (!latest || c.createdAt > latest.createdAt) latest = c;
  }
  return latest;
}
