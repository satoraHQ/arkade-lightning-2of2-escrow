import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { ZodError } from 'zod';
import { DefaultVtxo } from '@arkade-os/sdk';
import { config } from './config.js';
import { createStore } from './store.js';
import { loadOrCreatePeachIdentity } from './identity.js';
import { connectArk } from './ark.js';
import { offerRouter } from './routes/offer.js';
import { contractRouter } from './routes/contract.js';
import { startFundingPoller } from './polling.js';

async function main() {
  const peach = loadOrCreatePeachIdentity(config.peachSecretKeyPath);
  console.log(`[server] peach pubkey: ${peach.publicKeyHex}`);

  const ark = await connectArk(config.arkServerUrl, config.network);
  console.log(
    `[server] connected to ASP at ${config.arkServerUrl}, signerPubkey=${ark.info.signerPubkey}, network=${ark.info.network}`,
  );

  // Peach's fee-collection Ark address: a vanilla DefaultVtxo (peach + ASP)
  // owned by peach. Used as one of the two outputs of every release ark-tx.
  const peachFeeArkAddress =
    config.peachFeeArkAddress ??
    new DefaultVtxo.Script({
      pubKey: peach.publicKey,
      serverPubKey: ark.aspPubKey,
    })
      .address(ark.network.hrp, ark.aspPubKey)
      .encode();
  console.log(`[server] peach fee Ark address: ${peachFeeArkAddress}`);

  const store = createStore(config.dbPath);
  console.log(
    `[server] sqlite store at ${config.dbPath} ` +
      `(${store.offers.size} offers, ${store.contracts.size} contracts loaded)`,
  );

  const app = express();
  // CORS: open in PoC. Frontends run on 5173 (seller) / 5174 (buyer);
  // they need access to every endpoint including /healthz.
  app.use(cors());
  app.use(express.json());

  app.get('/healthz', (_req, res) => {
    res.json({
      ok: true,
      peachPubKey: peach.publicKeyHex,
      // x-only (32 bytes), already sign-byte-stripped from ark.info.signerPubkey
      aspPubKey: ark.aspPubKeyHex,
      network: ark.info.network,
      // Ark address human-readable prefix for this network (e.g. `ark` on
      // mainnet, `tark` on mutinynet/signet/testnet). Buyers build their
      // payout address with it, so it must match the ASP's network.
      hrp: ark.network.hrp,
      arkServerUrl: config.arkServerUrl,
      satoraApiUrl: config.satoraApiUrl,
      arkExplorerUrl: config.arkExplorerUrl,
      l1ExplorerUrl: config.l1ExplorerUrl,
      peachFeeArkAddress,
      // Peach commission in basis points. Buyers need it to compute the
      // payout split (sellAmount - fee) the /take endpoint enforces.
      feeBps: config.feeBps,
      // ASP's unilateral-exit timelock — same value the SDK Wallet uses
      // internally. Buyers need it so their payout DefaultVtxo address
      // matches what Wallet later derives for them.
      exitTimelock: {
        value: Number(ark.exitTimelock.value),
        type: ark.exitTimelock.type,
      },
    });
  });

  app.use(offerRouter({ store, ark, peach }));
  app.use(contractRouter({ store, ark, peach, feeBps: config.feeBps, peachFeeArkAddress }));

  // Centralised error handler. Runs whenever a route forwards or throws.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'validation_failed', issues: err.issues });
      return;
    }
    console.error('[server] unhandled:', err);
    res.status(500).json({ error: 'internal_error' });
  });

  const stopPoller = startFundingPoller(store, ark);

  const server = app.listen(config.port, () => {
    console.log(`[server] listening on http://localhost:${config.port}`);
  });

  const shutdown = () => {
    console.log('[server] shutting down');
    stopPoller();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[server] fatal:', err);
  process.exit(1);
});
