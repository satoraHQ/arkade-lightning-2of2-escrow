import {
  Client,
  IdbSwapStorage,
  IdbWalletStorage, type SwapStatus,
} from '@lendasat/lendaswap-sdk-pure';

/**
 * Cherry-picked subset of the swap response we actually consume —
 * lets us return an explicit type without depending on a non-public
 * subpath inside the SDK.
 */
export interface LnArkadeSwap {
  response: {
    id: string;
    bolt11_invoice: string;
    status?: string;
    arkade_vhtlc_address?: string;
  };
}

/**
 * One Lendaswap Client per (baseUrl) for the lifetime of the page. The
 * SDK keeps its mnemonic in IndexedDB (IdbWalletStorage) so refreshes
 * reuse the same depositor key tree and pending swaps stay claimable.
 */
const cache = new Map<string, Promise<Client>>();

export function getLendaswapClient(baseUrl: string): Promise<Client> {
  let cached = cache.get(baseUrl);
  if (!cached) {
    cached = Client.builder()
      .withBaseUrl(baseUrl)
      .withSignerStorage(new IdbWalletStorage())
      .withSwapStorage(new IdbSwapStorage())
      .build();
    cache.set(baseUrl, cached);
  }
  return cached;
}

/**
 * Kick off a LN → Arkade swap. The returned `response.bolt11_invoice`
 * is what the seller pays from any LN wallet; the swap's `id` is what
 * we poll until status reaches `serverfunded`.
 *
 * `targetAddress` is the destination of the user-side claim ark-tx —
 * the escrow VTXO address we want the funds to land at.
 */
export async function startLightningToArkadeSwap(
  baseUrl: string,
  satsReceive: number,
  targetArkAddress: string,
): Promise<LnArkadeSwap> {
  const client = await getLendaswapClient(baseUrl);
  const result = await client.createLightningToArkadeSwap({
    satsReceive,
    targetAddress: targetArkAddress,
  });
  return result as unknown as LnArkadeSwap;
}

/**
 * Subscribe to status updates for a single swap. Resolves to the
 * unsubscribe function. The SDK reuses one websocket across all
 * subscribers; calling unsubscribe drops just our handler and the
 * socket closes once no subscribers remain.
 *
 * The Lendaswap server pushes the current status on connect, so the
 * handler fires once immediately after subscribe — no separate seed
 * fetch is needed even after a mid-swap page refresh.
 */
export async function subscribeToSwap(
  baseUrl: string,
  swapId: string,
  onUpdate: (status: SwapStatus) => void,
): Promise<() => void> {
  const client = await getLendaswapClient(baseUrl);
  return client.subscribeToSwaps([swapId], (_id, status) => onUpdate(status));
}

/**
 * After the Lendaswap server has funded its side (status `serverfunded`),
 * the seller signs the user-side claim ark-tx that pays the escrow
 * address.
 */
export async function claimSwapToArk(
  baseUrl: string,
  swapId: string,
  destinationAddress: string,
) {
  const client = await getLendaswapClient(baseUrl);
  return client.claimArkade(swapId, { destinationAddress });
}
