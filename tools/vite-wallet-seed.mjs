import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';

/**
 * Vite dev-server plugin that backs a frontend wallet seed with a local file,
 * so the seed survives a localStorage wipe (clearing browser data, a new
 * profile, etc.). The seed file is the durable source of truth; the app reads
 * it at startup and mirrors it into localStorage.
 *
 * Endpoints (dev server only):
 *   GET    /__wallet_seed  -> { seed: <64-hex> | null }
 *   POST   /__wallet_seed  { seed } -> creates the file if absent, returns the
 *                            file's seed (never clobbers an existing one)
 *   DELETE /__wallet_seed  -> removes the file (wallet reset)
 *
 * In a production build these endpoints don't exist, so the app falls back to
 * localStorage. PoC only — the seed is stored unencrypted, same as before.
 *
 * @param {string} seedPath absolute path to the seed file
 */
export function walletSeedFile(seedPath) {
  const HEX64 = /^[0-9a-f]{64}$/;
  const readSeed = () => {
    if (!existsSync(seedPath)) return null;
    const s = readFileSync(seedPath, 'utf8').trim();
    return HEX64.test(s) ? s : null;
  };

  return {
    name: 'wallet-seed-file',
    apply: 'serve',
    configureServer(server) {
      const existing = readSeed();
      server.config.logger.info(
        existing
          ? `[wallet-seed] using ${seedPath}`
          : `[wallet-seed] no seed yet — created at ${seedPath} on first load`,
      );

      server.middlewares.use('/__wallet_seed', (req, res) => {
        const json = (code, obj) => {
          res.statusCode = code;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(obj));
        };
        try {
          if (req.method === 'GET') {
            return json(200, { seed: readSeed() });
          }
          if (req.method === 'DELETE') {
            if (existsSync(seedPath)) rmSync(seedPath);
            return json(200, { ok: true });
          }
          if (req.method === 'POST') {
            let body = '';
            req.on('data', (c) => (body += c));
            req.on('end', () => {
              try {
                const { seed } = JSON.parse(body || '{}');
                if (!HEX64.test(seed || '')) {
                  return json(400, { error: 'seed must be 64 hex chars' });
                }
                // Create only if absent — never overwrite an existing seed.
                if (!existsSync(seedPath)) {
                  writeFileSync(seedPath, seed, { mode: 0o600 });
                }
                return json(200, { seed: readSeed() });
              } catch {
                return json(500, { error: 'failed to write seed' });
              }
            });
            return;
          }
          json(405, { error: 'method not allowed' });
        } catch (e) {
          json(500, { error: String(e) });
        }
      });
    },
  };
}
