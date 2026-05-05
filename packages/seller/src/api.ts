import type {
  CreateOfferRequest,
  CreateOfferResponse,
  FundingStatus,
  RegisterEscrowRequest,
  RegisterEscrowResponse,
  ContractStatus,
  ReleasePsbtResponse,
  SubmitSellerSigRequest,
  SubmitSellerSigResponse,
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
  health: () =>
    jsonFetch<{
      ok: boolean;
      peachPubKey: string;
      aspPubKey: string;
      network: string;
      arkServerUrl: string;
      lendaswapApiUrl: string;
      peachFeeArkAddress: string;
      exitTimelock: { value: number; type: 'blocks' | 'seconds' };
    }>('/healthz'),

  createOffer: (body: CreateOfferRequest) =>
    jsonFetch<CreateOfferResponse>('/v1/offer', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  registerEscrow: (offerId: string, body: RegisterEscrowRequest) =>
    jsonFetch<RegisterEscrowResponse>(`/v1/offer/${offerId}/escrow`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  funding: (offerId: string) =>
    jsonFetch<FundingStatus>(`/v1/offer/${offerId}/funding`),

  contract: (contractId: string) =>
    jsonFetch<ContractStatus>(`/v1/contract/${contractId}`),

  releasePsbt: (contractId: string) =>
    jsonFetch<ReleasePsbtResponse>(`/v1/contract/${contractId}/release-psbt`),

  releaseSig: (contractId: string, body: SubmitSellerSigRequest) =>
    jsonFetch<SubmitSellerSigResponse>(
      `/v1/contract/${contractId}/release-sig`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
};
