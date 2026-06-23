import type {
  ContractStatus,
  OfferSummary,
  TakeOfferRequest,
  TakeOfferResponse,
} from '@arkade-peach-escrow-poc/shared';

const BASE = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? 'http://localhost:3210';

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${path}: ${text}`);
  }
  return (await res.json()) as T;
}

export const api = {
  listOffers: () => jsonFetch<OfferSummary[]>('/v1/offers'),

  takeOffer: (offerId: string, body: TakeOfferRequest) =>
    jsonFetch<TakeOfferResponse>(`/v1/offer/${offerId}/take`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  contract: (contractId: string) =>
    jsonFetch<ContractStatus>(`/v1/contract/${contractId}`),

  health: () =>
    jsonFetch<{
      ok: boolean;
      peachPubKey: string;
      aspPubKey: string;
      network: string;
      hrp: string;
      arkServerUrl: string;
      satoraApiUrl: string;
      arkExplorerUrl: string;
      l1ExplorerUrl: string;
      peachFeeArkAddress: string;
      feeBps: number;
      exitTimelock: { value: number; type: 'blocks' | 'seconds' };
    }>('/healthz'),
};
