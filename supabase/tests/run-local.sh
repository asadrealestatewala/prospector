#!/usr/bin/env bash
# Applies every migration to a throwaway local Postgres and runs the SQL checks.
# Needs Postgres 15+ binaries on PATH (initdb, pg_ctl, psql). Usage: npm run db:test
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
export PATH="$PGBIN:$PATH"
TMP="$(mktemp -d)"
AS=()
if [ "$(id -u)" = 0 ]; then chown postgres "$TMP"; AS=(runuser -u postgres --); fi
PORT="${PGPORT_TEST:-54329}"
trap '"${AS[@]}" pg_ctl -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
"${AS[@]}" initdb -D "$TMP/data" -U postgres -A trust >/dev/null
"${AS[@]}" pg_ctl -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" start >/dev/null
PSQL=(psql -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -o /dev/null)
"${PSQL[@]}" -f "$ROOT/supabase/tests/supabase-stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "apply $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
echo "run checks"
"${PSQL[@]}" -f "$ROOT/supabase/tests/checks.sql" -f "$ROOT/supabase/tests/checks_step2.sql" -f "$ROOT/supabase/tests/checks_step3.sql" -f "$ROOT/supabase/tests/checks_step4.sql"
echo "all database checks passed"
