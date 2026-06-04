import {
  Client,
  IdbSwapStorage,
  IdbWalletStorage,
  type SwapStatus,
} from '@satora/swap';

/**
 * One Lendaswap Client per (baseUrl) for the lifetime of the page. The
 * SDK keeps its mnemonic in IndexedDB (IdbWalletStorage) so refreshes
 * reuse the same depositor key tree and pending swaps stay claimable.
 *
 * This client is injected into `@satora/escrow-client`'s EscrowClient (it
 * structurally satisfies the swap surface) — the escrow-client owns swap
 * creation + claim; here we keep it only to drive the live status UI and
 * the post-refresh resume claim below.
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
