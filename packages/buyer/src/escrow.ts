import {
  InMemoryContractRepository,
  InMemoryWalletRepository,
  RestArkProvider,
  RestIndexerProvider,
} from '@arkade-os/sdk';
import { EscrowClient } from '@satora/escrow-client';
import { Client, IdbSwapStorage, IdbWalletStorage } from '@satora/swap';

/**
 * One swap Client per Lendaswap baseUrl. Persisted in IndexedDB so a refresh
 * mid-withdrawal reuses the same depositor key tree. Injected into the
 * EscrowClient below (it structurally satisfies the swap surface).
 */
const swapCache = new Map<string, Promise<Client>>();

function getSwapClient(baseUrl: string): Promise<Client> {
  let cached = swapCache.get(baseUrl);
  if (!cached) {
    cached = Client.builder()
      .withBaseUrl(baseUrl)
      .withSignerStorage(new IdbWalletStorage())
      .withSwapStorage(new IdbSwapStorage())
      .build();
    swapCache.set(baseUrl, cached);
  }
  return cached;
}

/**
 * One EscrowClient per (lendaswapApiUrl, arkServerUrl) for the page lifetime.
 * Drives `withdrawToL1` (collaborative offboard) and `withdrawToLightning`
 * (Arkade→Lightning swap) for the buyer's released payout.
 */
const cache = new Map<string, Promise<EscrowClient>>();

export function getEscrowClient(
  lendaswapApiUrl: string,
  arkServerUrl: string,
): Promise<EscrowClient> {
  const key = `${lendaswapApiUrl}|${arkServerUrl}`;
  let cached = cache.get(key);
  if (!cached) {
    cached = (async () => {
      const swap = await getSwapClient(lendaswapApiUrl);
      return EscrowClient.create({
        swap,
        arkProvider: new RestArkProvider(arkServerUrl),
        indexerProvider: new RestIndexerProvider(arkServerUrl),
        contractRepository: new InMemoryContractRepository(),
        walletRepository: new InMemoryWalletRepository(),
      });
    })().catch((err) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, cached);
  }
  return cached;
}
