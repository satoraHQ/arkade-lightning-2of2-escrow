import 'dotenv/config';
import { z } from 'zod';
import type { NetworkName } from '@arkade-os/sdk';

const NetworkSchema = z.enum([
  'bitcoin',
  'testnet',
  'signet',
  'mutinynet',
  'regtest',
]);

const Schema = z.object({
  ARK_SERVER_URL: z.string().url(),
  LENDASWAP_API_URL: z.string().url().default('https://mutinynetswap.lendasat.com'),
  NETWORK: NetworkSchema,
  PORT: z.coerce.number().int().positive().default(3210),
  PEACH_SECRET_KEY_PATH: z.string().default('./peach-server.key'),
  FEE_BPS: z.coerce.number().int().nonnegative().default(10),
  PEACH_FEE_ARK_ADDRESS: z.string().optional(),
  // Block explorers the frontends link to (served via /healthz). Defaults are
  // mutinynet; set the mainnet equivalents when NETWORK=bitcoin.
  ARK_EXPLORER_URL: z.string().url().default('https://explorer.mutinynet.arkade.sh'),
  L1_EXPLORER_URL: z.string().url().default('https://mutinynet.com'),
});

const parsed = Schema.parse(process.env);

export const config = {
  arkServerUrl: parsed.ARK_SERVER_URL,
  lendaswapApiUrl: parsed.LENDASWAP_API_URL,
  network: parsed.NETWORK as NetworkName,
  port: parsed.PORT,
  peachSecretKeyPath: parsed.PEACH_SECRET_KEY_PATH,
  feeBps: parsed.FEE_BPS,
  peachFeeArkAddress: parsed.PEACH_FEE_ARK_ADDRESS,
  arkExplorerUrl: parsed.ARK_EXPLORER_URL,
  l1ExplorerUrl: parsed.L1_EXPLORER_URL,
} as const;

export type Config = typeof config;
