/**
 * Buyer's commitment to a payout Ark address.
 *
 * Real Peach binds the buyer's userId to their payout address via a
 * BIP-322 signature over `"I confirm that only I, <peachId>, control the
 * address <addr>"` using a P2WPKH key (peach-app
 * `views/contract/ContractSliders.tsx:123-138`).
 *
 * For Arkade we can't reuse BIP-322 directly: the buyer's destination is
 * an Ark address (bech32m wrapping a server pubkey + vtxo taproot key),
 * not a P2WPKH/P2TR L1 address. Instead we have the buyer Schnorr-sign a
 * deterministic message tying the offer, the destination address, and the
 * x-only pubkey embedded in that destination.
 */
export function payoutCommitmentMessage(
  offerId: string,
  payoutArkAddress: string,
): string {
  return `peach-escrow-poc:take:${offerId}:${payoutArkAddress}`;
}
