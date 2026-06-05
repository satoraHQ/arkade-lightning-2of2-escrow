import type { ReactNode } from 'react';

// Explorer bases default to mutinynet; `configureExplorers()` overrides them at
// app boot from the server's /healthz, so links follow the configured network.
let arkExplorerBase = 'https://explorer.mutinynet.arkade.sh';
let l1ExplorerBase = 'https://mutinynet.com';

export function configureExplorers(urls: { ark?: string; l1?: string }): void {
  if (urls.ark) arkExplorerBase = urls.ark;
  if (urls.l1) l1ExplorerBase = urls.l1;
}

export function arkTxLink(txid: string): string {
  return `${arkExplorerBase}/tx/${txid}`;
}

export function arkAddressLink(address: string): string {
  return `${arkExplorerBase}/address/${address}`;
}

export function l1TxLink(txid: string): string {
  return `${l1ExplorerBase}/tx/${txid}`;
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
