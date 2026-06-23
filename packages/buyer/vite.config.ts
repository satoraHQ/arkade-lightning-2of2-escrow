import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { walletSeedFile } from '../../tools/vite-wallet-seed.mjs';

// Seed file lives at the repo root — outside Vite's served root, so it can't
// be fetched as a static asset; only the /__wallet_seed endpoint exposes it.
const seedPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../.wallet-seed-buyer',
);

export default defineConfig({
  plugins: [
    react(),
    walletSeedFile(seedPath),
    // @satora/swap pulls in @zerodev/sdk + viem (EVM), which
    // import node builtins like `events` and `buffer`. Polyfill them in the
    // browser bundle so the Lightning-withdrawal import graph resolves.
    nodePolyfills({ include: ['events', 'buffer', 'process', 'stream', 'crypto', 'util'] }),
  ],
  server: { port: 5174 },
  define: { global: 'globalThis' },
  // @satora/escrow (+ escrow-client) and this app both pull in
  // @arkade-os/sdk. Dedupe so the bundle has a single copy — otherwise
  // `EscrowVtxoScript extends VtxoScript` can hit two different VtxoScript
  // classes ("Class extends undefined").
  resolve: { dedupe: ['@arkade-os/sdk', '@scure/base'] },
});
