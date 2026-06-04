/**
 * API contract types shared between server, seller, and buyer apps.
 *
 * Pubkeys are 32-byte x-only Schnorr keys, hex-encoded over the wire.
 * Amounts are sat values as `number` (PoC-only — switch to bigint for prod).
 */

export type HexPubKey = string;
export type ArkAddress = string;
export type ArkTxid = string;

export type OfferStatus =
  | 'PENDING_ESCROW'   // seller registered offer, waiting for escrow pubkey
  | 'AWAITING_FUNDING' // escrow address issued, waiting for funding
  | 'FUNDED'           // funded VTXO observed, offer is live
  | 'TAKEN'            // buyer took the offer, contract created
  | 'RELEASED'         // release ark-tx broadcast
  | 'CANCELLED'        // refund tx broadcast or offer cancelled
  | 'EXPIRED';         // CSV elapsed and server swept

export interface CreateOfferRequest {
  /**
   * Amount the seller wants to sell, in sats. This is the *intended*
   * amount, captured at offer creation. The actual sats observed at the
   * escrow address (post-funding) is exposed separately as
   * `FundingStatus.fundedAmountSats` — see notes there.
   */
  sellAmountSats: number;
}

export interface CreateOfferResponse {
  offerId: string;
}

export interface RegisterEscrowRequest {
  /**
   * Seller's per-offer x-only pubkey (32 bytes hex), derived from the
   * seller's seed and the server-assigned `offerId`. Goes into the
   * cooperative tapleaf of the escrow VtxoScript.
   *
   * Real Peach derives this BIP32-style at `m/84'/{0,1}'/0'/55'/3/<offerId>`
   * — needs the server-assigned offerId first, hence the two-step
   * create-then-register flow.
   *
   * The seller's refund destination is collected at refund time, not
   * here — committing to it up front buys nothing for the cooperative
   * refund flow.
   */
  sellerPubKey: HexPubKey;
}

export interface RegisterEscrowResponse {
  escrowVtxoArkAddress: ArkAddress;
  arbiterPubKey: HexPubKey;
  aspPubKey: HexPubKey;
  csvTimelock: { value: number; type: 'blocks' | 'seconds' };
}

export interface FundingStatus {
  status: 'PENDING' | 'FUNDED' | 'WRONG_AMOUNT';
  /**
   * The offer parameter — what the seller said they'd sell. Set at
   * offer creation, never changes. Used pre-funding by the seller
   * frontend to size the LN swap, and by the server to validate the
   * buyer's take amount.
   */
  sellAmountSats: number;
  fundingTxid?: ArkTxid;
  /**
   * Sats actually observed at the escrow address by the funding poller
   * (sum of unspent VTXOs). Undefined until at least one VTXO has
   * landed. This is the load-bearing number at release time — it goes
   * into the PSBT input's witnessUtxo.amount and must match the on-chain
   * truth, otherwise the ASP rejects the spend. Equal to
   * `sellAmountSats` in the happy path.
   */
  fundedAmountSats?: number;
  /** Set once a buyer has taken this offer. */
  contractId?: string;
}

export interface TakeOfferRequest {
  /** Sats the buyer wants to receive. Must equal sellAmountSats - feeSats. */
  amountSats: number;
  /** Buyer's Arkade VTXO address to receive payout. */
  payoutArkAddress: ArkAddress;
  /** Buyer's x-only pubkey controlling payoutArkAddress. */
  buyerPubKey: HexPubKey;
  /**
   * Schnorr signature by buyerPubKey over the message
   *   `peach-escrow-poc:take:<offerId>:<payoutArkAddress>`
   * Commits the buyer to the payout destination.
   */
  payoutAddressSig: string;
}

export interface TakeOfferResponse {
  contractId: string;
}

export interface ReleasePsbtResponse {
  /**
   * Base64-encoded ark-tx PSBT. Built by the server with the cooperative
   * tapleaf, control block, and SIGHASH_DEFAULT pre-attached. Seller signs
   * input 0 only (no finalize) and returns the partial sig.
   */
  arkTxPsbtB64: string;
  /** Same shape, for the checkpoint transactions. */
  checkpointPsbtsB64: string[];
  /**
   * The release outputs the seller should expect, so it can run
   * `verifyReleaseArkTx` over the PSBTs before signing. Amounts are sats as
   * `number` (PoC-only).
   */
  expected: {
    escrowOutpoint: { txid: ArkTxid; vout: number };
    buyerArkAddress: ArkAddress;
    buyerAmountSats: number;
    feeArkAddress: ArkAddress;
    feeAmountSats: number;
  };
}

export interface SubmitSellerSigRequest {
  /** Output of `signEscrowArkTx(arkTxPsbtB64, sellerSk)`. */
  sellerSignedArkTxPsbtB64: string;
  /**
   * Output of `signEscrowCheckpoints(checkpointPsbtsB64, sellerSk)`.
   * One entry per checkpoint returned in `ReleasePsbtResponse`.
   */
  sellerSignedCheckpointPsbtsB64: string[];
}

export interface SubmitSellerSigResponse {
  arkTxid: ArkTxid;
}

export interface ContractStatus {
  contractId: string;
  offerId: string;
  status: OfferStatus;
  arkTxid?: ArkTxid;
}

export interface OfferSummary {
  offerId: string;
  sellAmountSats: number;
  status: OfferStatus;
  escrowArkAddress: string;
  createdAt: number;
}
