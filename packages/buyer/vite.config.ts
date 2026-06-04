import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    react(),
    // @satora/swap (Lendaswap) pulls in @zerodev/sdk + viem (EVM), which
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
