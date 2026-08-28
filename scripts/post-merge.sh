#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run push
node lib/db/scripts/migrate-registry-view-order.mjs
pnpm --filter @workspace/db run verify:ownership-schema
