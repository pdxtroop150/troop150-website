#!/usr/bin/env -S bash -x -e

if [ ! -d node_modules ]; then
    npm install
    npx astro telemetry disable
fi

# Kill running astro process if it exists
PID=$(ps a | grep -e 'node .*/astro dev' | grep -v 'grep' | awk ' { print $1 }')
if [ -n "$PID" ]; then
    kill "$PID"
fi

npm run dev