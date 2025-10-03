#!/usr/bin/env bash
set -euo pipefail

echo "[run] Installing dependencies..."
pnpm install --recursive

echo "[run] Generating proto code..."
pnpm run gen

echo "[run] Patching generated imports..."
# Fixes incorrect "price_pbts" import to "price_pb"
sed -i 's/\.\/price_pbts/\.\/price_pb/' proto/gen/price_connect.ts

echo "[run] Starting server and web..."
# Start server in background
(cd apps/server && pnpm dev) &

# Wait a bit so server is ready
sleep 2

# Start web (this will stay in foreground)
(cd apps/web && pnpm dev)
