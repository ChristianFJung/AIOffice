#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "🧪 Running tests..."
echo ""

# Start server and web in background
npm run dev:server &
SERVER_PID=$!
npm run dev:web &
WEB_PID=$!

cleanup() {
  echo ""
  echo "Cleaning up..."
  kill $SERVER_PID $WEB_PID 2>/dev/null || true
}
trap cleanup EXIT

# Wait for server to be ready
echo "Waiting for server..."
for i in $(seq 1 30); do
  if curl -s http://localhost:3003/agents > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "Running Playwright tests..."
npx playwright test "$@"
