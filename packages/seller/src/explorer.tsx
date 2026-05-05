import type { ReactNode } from 'react';

const EXPLORER_BASE = 'https://explorer.mutinynet.arkade.sh';

export function txLink(txid: string): string {
  return `${EXPLORER_BASE}/tx/${txid}`;
}

export function addressLink(address: string): string {
  return `${EXPLORER_BASE}/address/${address}`;
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
