import {
  InMemoryContractRepository,
  InMemoryWalletRepository,
  type Network,
  networks,
  RestArkProvider,
  RestIndexerProvider,
} from '@arkade-os/sdk';
import { type EscrowScriptOptions, EscrowVtxoScript } from '@satora/escrow';
import { EscrowClient } from '@satora/escrow-client';
import { hex } from '@scure/base';
import type { RegisterEscrowResponse } from '@arkade-peach-escrow-poc/shared';
import { getLendaswapClient } from './lendaswap.js';

/**
 * One EscrowClient per (lendaswapApiUrl, arkServerUrl) for the lifetime of
 * the page. It bundles the swap on-ramp (`@satora/swap` Client, injected)
 * with the escrow monitor, and is what drives `fundFromLightning`.
 *
 * We also cache the resolved `Network` (from the ASP's `getInfo`) so address
 * derivation matches exactly what the server used.
 */
const cache = new Map<
  string,
  Promise<{ client: EscrowClient; network: Network }>
>();

export function getEscrowClient(
  lendaswapApiUrl: string,
  arkServerUrl: string,
): Promise<{ client: EscrowClient; network: Network }> {
  const key = `${lendaswapApiUrl}|${arkServerUrl}`;
  let cached = cache.get(key);
  if (!cached) {
    cached = (async () => {
      const swap = await getLendaswapClient(lendaswapApiUrl);
      const arkProvider = new RestArkProvider(arkServerUrl);
      const indexerProvider = new RestIndexerProvider(arkServerUrl);
      const info = await arkProvider.getInfo();
      const network = networks[info.network as keyof typeof networks];
      if (!network) throw new Error(`Unsupported network: ${info.network}`);
      const client = await EscrowClient.create({
        swap,
        arkProvider,
        indexerProvider,
        contractRepository: new InMemoryContractRepository(),
        walletRepository: new InMemoryWalletRepository(),
      });
      return { client, network };
    })().catch((err) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, cached);
  }
  return cached;
}

/**
 * Reconstruct the escrow script the seller is a co-party to, from its own
 * per-offer pubkey plus the arbiter/asp/timelock the server returned.
 *
 * As a safety check we re-derive the Ark address and assert it matches the
 * server-issued one: the seller funds an escrow whose script it has verified,
 * not an opaque address handed back by the server.
 */
export function buildEscrowOptions(
  sellerPubKey: Uint8Array,
  escrow: RegisterEscrowResponse,
  network: Network,
): EscrowScriptOptions {
  const options: EscrowScriptOptions = {
    sellerPubKey,
    arbiterPubKey: hex.decode(escrow.arbiterPubKey),
    arkadeServerPubKey: hex.decode(escrow.aspPubKey),
    exitTimelock: {
      value: BigInt(escrow.csvTimelock.value),
      type: escrow.csvTimelock.type,
    },
  };
  const derived = new EscrowVtxoScript(options).arkAddress(network);
  if (derived !== escrow.escrowVtxoArkAddress) {
    throw new Error(
      `escrow address mismatch — server issued ${escrow.escrowVtxoArkAddress} ` +
        `but the reconstructed script derives ${derived}`,
    );
  }
  return options;
}
