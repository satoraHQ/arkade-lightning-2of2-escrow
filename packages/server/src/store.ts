/**
 * sqlite-backed store for the Peach-style server. State persists across
 * restarts (a stranded contract can be picked up again after a crash/restart).
 *
 * Reads go through in-memory Maps (`offers`, `contracts`) loaded from sqlite
 * at startup; writes go through `saveOffer` / `saveContract`, which upsert to
 * sqlite AND refresh the cache. Mutate an object then call the matching save —
 * an in-place mutation alone does NOT persist.
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

import Database from 'better-sqlite3';

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
  /** In-memory read cache, loaded from sqlite at startup. Do not mutate keys
   *  directly to persist — use {@link Store.saveOffer}. */
  offers: Map<string, Offer>;
  contracts: Map<string, Contract>;
  /** Upsert an offer to sqlite and refresh the cache. */
  saveOffer(offer: Offer): void;
  /** Upsert a contract to sqlite and refresh the cache. */
  saveContract(contract: Contract): void;
}

/** Open the sqlite db at `dbPath`, create tables, and load rows into Maps. */
export function createStore(dbPath: string): Store {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS offers (
      id               TEXT PRIMARY KEY,
      sellAmountSats   INTEGER NOT NULL,
      status           TEXT NOT NULL,
      sellerPubKeyHex  TEXT,
      escrowArkAddress TEXT,
      escrowPkScript   BLOB,
      fundingTxid      TEXT,
      fundingVout      INTEGER,
      fundedAmountSats INTEGER,
      createdAt        INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contracts (
      id                    TEXT PRIMARY KEY,
      offerId               TEXT NOT NULL,
      buyerPubKeyHex        TEXT NOT NULL,
      buyerPayoutArkAddress TEXT NOT NULL,
      buyerAmountSats       INTEGER NOT NULL,
      payoutAddressSig      TEXT NOT NULL,
      arkTxid               TEXT,
      status                TEXT NOT NULL,
      createdAt             INTEGER NOT NULL
    );
  `);

  const offers = new Map<string, Offer>();
  for (const row of db.prepare('SELECT * FROM offers').all() as OfferRow[]) {
    offers.set(row.id, rowToOffer(row));
  }
  const contracts = new Map<string, Contract>();
  for (const row of db
    .prepare('SELECT * FROM contracts')
    .all() as ContractRow[]) {
    contracts.set(row.id, rowToContract(row));
  }

  const upsertOffer = db.prepare(`
    INSERT INTO offers (id, sellAmountSats, status, sellerPubKeyHex,
      escrowArkAddress, escrowPkScript, fundingTxid, fundingVout,
      fundedAmountSats, createdAt)
    VALUES (@id, @sellAmountSats, @status, @sellerPubKeyHex,
      @escrowArkAddress, @escrowPkScript, @fundingTxid, @fundingVout,
      @fundedAmountSats, @createdAt)
    ON CONFLICT(id) DO UPDATE SET
      sellAmountSats=excluded.sellAmountSats, status=excluded.status,
      sellerPubKeyHex=excluded.sellerPubKeyHex,
      escrowArkAddress=excluded.escrowArkAddress,
      escrowPkScript=excluded.escrowPkScript, fundingTxid=excluded.fundingTxid,
      fundingVout=excluded.fundingVout, fundedAmountSats=excluded.fundedAmountSats
  `);
  const upsertContract = db.prepare(`
    INSERT INTO contracts (id, offerId, buyerPubKeyHex, buyerPayoutArkAddress,
      buyerAmountSats, payoutAddressSig, arkTxid, status, createdAt)
    VALUES (@id, @offerId, @buyerPubKeyHex, @buyerPayoutArkAddress,
      @buyerAmountSats, @payoutAddressSig, @arkTxid, @status, @createdAt)
    ON CONFLICT(id) DO UPDATE SET
      arkTxid=excluded.arkTxid, status=excluded.status
  `);

  return {
    offers,
    contracts,
    saveOffer(offer: Offer): void {
      upsertOffer.run({
        id: offer.id,
        sellAmountSats: offer.sellAmountSats,
        status: offer.status,
        sellerPubKeyHex: offer.sellerPubKeyHex ?? null,
        escrowArkAddress: offer.escrowArkAddress ?? null,
        escrowPkScript: offer.escrowPkScript
          ? Buffer.from(offer.escrowPkScript)
          : null,
        fundingTxid: offer.fundingTxid ?? null,
        fundingVout: offer.fundingVout ?? null,
        fundedAmountSats: offer.fundedAmountSats ?? null,
        createdAt: offer.createdAt,
      });
      offers.set(offer.id, offer);
    },
    saveContract(contract: Contract): void {
      upsertContract.run({
        id: contract.id,
        offerId: contract.offerId,
        buyerPubKeyHex: contract.buyerPubKeyHex,
        buyerPayoutArkAddress: contract.buyerPayoutArkAddress,
        buyerAmountSats: contract.buyerAmountSats,
        payoutAddressSig: contract.payoutAddressSig,
        arkTxid: contract.arkTxid ?? null,
        status: contract.status,
        createdAt: contract.createdAt,
      });
      contracts.set(contract.id, contract);
    },
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

interface OfferRow {
  id: string;
  sellAmountSats: number;
  status: string;
  sellerPubKeyHex: string | null;
  escrowArkAddress: string | null;
  escrowPkScript: Buffer | null;
  fundingTxid: string | null;
  fundingVout: number | null;
  fundedAmountSats: number | null;
  createdAt: number;
}

interface ContractRow {
  id: string;
  offerId: string;
  buyerPubKeyHex: string;
  buyerPayoutArkAddress: string;
  buyerAmountSats: number;
  payoutAddressSig: string;
  arkTxid: string | null;
  status: string;
  createdAt: number;
}

function rowToOffer(row: OfferRow): Offer {
  const offer: Offer = {
    id: row.id,
    sellAmountSats: row.sellAmountSats,
    status: row.status as OfferStatus,
    createdAt: row.createdAt,
  };
  if (row.sellerPubKeyHex !== null) offer.sellerPubKeyHex = row.sellerPubKeyHex;
  if (row.escrowArkAddress !== null)
    offer.escrowArkAddress = row.escrowArkAddress;
  if (row.escrowPkScript !== null)
    offer.escrowPkScript = new Uint8Array(row.escrowPkScript);
  if (row.fundingTxid !== null) offer.fundingTxid = row.fundingTxid;
  if (row.fundingVout !== null) offer.fundingVout = row.fundingVout;
  if (row.fundedAmountSats !== null)
    offer.fundedAmountSats = row.fundedAmountSats;
  return offer;
}

function rowToContract(row: ContractRow): Contract {
  const contract: Contract = {
    id: row.id,
    offerId: row.offerId,
    buyerPubKeyHex: row.buyerPubKeyHex,
    buyerPayoutArkAddress: row.buyerPayoutArkAddress,
    buyerAmountSats: row.buyerAmountSats,
    payoutAddressSig: row.payoutAddressSig,
    status: row.status as ContractStatus,
    createdAt: row.createdAt,
  };
  if (row.arkTxid !== null) contract.arkTxid = row.arkTxid;
  return contract;
}
