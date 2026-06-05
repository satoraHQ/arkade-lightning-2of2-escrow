import type { ReactNode } from 'react';

// Ark explorer base defaults to mutinynet; `configureExplorers()` overrides it
// at app boot from the server's /healthz, so links follow the configured network.
let arkExplorerBase = 'https://explorer.mutinynet.arkade.sh';

export function configureExplorers(urls: { ark?: string }): void {
  if (urls.ark) arkExplorerBase = urls.ark;
}

export function txLink(txid: string): string {
  return `${arkExplorerBase}/tx/${txid}`;
}

export function addressLink(address: string): string {
  return `${arkExplorerBase}/address/${address}`;
}

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
      href={txLink(txid)}
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
      href={addressLink(address)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children ?? address}
    </a>
  );
}
