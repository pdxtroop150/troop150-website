#!/usr/bin/env -S bash -x -e

# Kill running wrangler process if it exists
PID=$(ps a | grep 'npm exec wrangler' | grep -v 'grep' | awk ' { print $1 }')
if [ -n "$PID" ]; then
    kill "$PID"
fi

npx -y wrangler@latest pages dev --port 8788 . --compatibility-date=2024-10-20 --r2 LOST_AND_FOUND_ITEMS 