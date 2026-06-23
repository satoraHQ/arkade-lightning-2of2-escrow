set shell := ["bash", "-cu"]
set dotenv-load := false

# List available recipes.
default:
    @just --list

# Install all workspace dependencies.
install:
    npm install

# On first run copies .env.<network>.example to .env. An existing .env is kept
# (your edits are safe); a NETWORK mismatch only warns. To switch networks,
# run `just reset-env` first.
# Run the Peach-style server against a network (mutinynet | mainnet).
server network="mutinynet":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{network}}" in mutinynet|mainnet) ;; *)
      echo "error: network must be 'mutinynet' or 'mainnet' (got '{{network}}')" >&2; exit 1 ;;
    esac
    if [[ ! -f .env ]]; then
      cp ".env.{{network}}.example" .env
      echo "[just] created .env from .env.{{network}}.example"
    else
      want=$([[ "{{network}}" == mainnet ]] && echo bitcoin || echo mutinynet)
      have=$(grep -E '^NETWORK=' .env | cut -d= -f2- || true)
      if [[ "$have" != "$want" ]]; then
        echo "[just] WARNING: existing .env has NETWORK=$have but you asked for {{network}} ($want)." >&2
        echo "[just]          run 'just reset-env' to regenerate from .env.{{network}}.example." >&2
      fi
    fi
    npm run dev --workspace @arkade-peach-escrow-poc/server

# Run the seller frontend (Vite, http://localhost:5173).
seller:
    npm run dev --workspace @arkade-peach-escrow-poc/seller

# Run the buyer frontend (Vite, http://localhost:5174). Server must be up.
buyer:
    npm run dev --workspace @arkade-peach-escrow-poc/buyer

# Typecheck every package.
typecheck:
    npm run typecheck

# Build every package (including production Vite bundles).
build:
    npm run build

# Wipe server local state: the peach hot key (repo root) and the sqlite database.
reset-server:
    rm -f .wallet-seed-server packages/server/peach-server.sqlite packages/server/peach-server.sqlite-shm packages/server/peach-server.sqlite-wal

# Delete the local .env so the next `just server <network>` regenerates it.
reset-env:
    rm -f .env

# Probe the server's /healthz endpoint.
healthz host="http://localhost:3210":
    curl -s {{host}}/healthz | python3 -m json.tool
