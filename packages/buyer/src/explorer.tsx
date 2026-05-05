import type { ReactNode } from 'react';

const ARK_EXPLORER_BASE = 'https://explorer.mutinynet.arkade.sh';
const L1_EXPLORER_BASE = 'https://mutinynet.com';

export function arkTxLink(txid: string): string {
  return `${ARK_EXPLORER_BASE}/tx/${txid}`;
}

export function arkAddressLink(address: string): string {
  return `${ARK_EXPLORER_BASE}/address/${address}`;
}

export function l1TxLink(txid: string): string {
  return `${L1_EXPLORER_BASE}/tx/${txid}`;
}

/** Ark-side tx (VTXO spend). Resolves on the Arkade explorer. */
export function ExplorerTx({
  txid,
  children,
}: {
  txid: string;
  children?: ReactNode;
}) {
  return (
    <a
      className="mono"
      href={arkTxLink(txid)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children ?? txid}
    </a>
  );
}

export function ExplorerAddress({
  address,
  children,
}: {
  address: string;
  children?: ReactNode;
}) {
  return (
    <a
      className="mono"
      href={arkAddressLink(address)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children ?? address}
    </a>
  );
}

/**
 * L1 onchain tx — used for settlement / offboard txids returned by
 * `Ramps.offboard`, which broadcasts an actual mutinynet Bitcoin
 * transaction. These won't resolve on the Arkade explorer.
 */
export function L1ExplorerTx({
  txid,
  children,
}: {
  txid: string;
  children?: ReactNode;
}) {
  return (
    <a
      className="mono"
      href={l1TxLink(txid)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children ?? txid}
    </a>
  );
}
