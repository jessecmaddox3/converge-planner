#!/usr/bin/env bash
set -euo pipefail
# Only run against a disposable database. Never accepts a production host.
case "${PGHOST:-}" in
  127.0.0.1|localhost) ;;
  *) echo 'Set PGHOST to localhost or 127.0.0.1 for a disposable database.' >&2; exit 1 ;;
esac
case "${PGDATABASE:-}" in
  converge_test|converge_contract_*) ;;
  *) echo 'Use a converge_test or converge_contract_* database.' >&2; exit 1 ;;
esac
psql -X -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
end $$;
SQL
# The lifecycle migration contains the verified clean-database table definitions.
# Do not invent the missing production migration's history entry.
for migration in supabase/migrations/*.sql; do
  psql -X -v ON_ERROR_STOP=1 -f "$migration"
done
for contract in supabase/tests/*.sql; do
  psql -X -v ON_ERROR_STOP=1 -f "$contract"
done

python3 tools/test-notification-concurrency.py
