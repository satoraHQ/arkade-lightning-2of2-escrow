set shell := ["bash", "-cu"]
set dotenv-load := false

# List available recipes.
default:
    @just --list

# Install all workspace dependencies.
install:
    npm install

# Run the Peach-style server (Express + sqlite, http://localhost:3210).
server:
    cp -n .env.mutinynet.example .env || true
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

# Wipe server local state (peach hot key — db is in-memory, restarts the
# server to clear it).
reset-server:
    rm -f packages/server/peach-server.key

# Probe the server's /healthz endpoint.
healthz host="http://localhost:3210":
    curl -s {{host}}/healthz | python3 -m json.tool
