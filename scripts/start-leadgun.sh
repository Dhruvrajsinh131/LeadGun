#!/usr/bin/env bash
set -u

ROOT="/home/personal/LeadGun"
LOGDIR="$ROOT/logs"
PGCTL="/usr/lib/postgresql/18/bin/pg_ctl"
NODE_BIN="/home/personal/.nvm/versions/node/v24.20.0/bin"

export PATH="$NODE_BIN:/usr/local/bin:/usr/bin:/bin"
mkdir -p "$LOGDIR" /tmp/opencode

if ! "$PGCTL" -D "$ROOT/.pgdata" status >/dev/null 2>&1; then
  "$PGCTL" -D "$ROOT/.pgdata" -o "-k /tmp/opencode -p 5433" -l "$ROOT/.pgdata/pg.log" start >>"$LOGDIR/postgres-startup.log" 2>&1
fi

cd "$ROOT" || exit 1

if ! pgrep -f "node --max-old-space-size=4096 src/server.js" >/dev/null 2>&1; then
  nohup "$NODE_BIN/node" --max-old-space-size=4096 src/server.js --no-scrape >>"$LOGDIR/backend.log" 2>&1 &
fi

if ! pgrep -f "next dev" >/dev/null 2>&1; then
  nohup "$NODE_BIN/npm" --prefix web run dev >>"$LOGDIR/ui.log" 2>&1 &
fi
