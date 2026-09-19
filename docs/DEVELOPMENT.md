# Development and verification

> **Start:** Node 22 or 24, `npm ci`, then `npm run dev`. The development server uses the same fictional local mode and persistent database as the release. Keep real data and credentials outside the source tree.

## Routine checks

```sh
npm test
npm run typecheck
npm run build
```

The unit suite uses invented inputs and mocked external providers. To make any accidental outgoing transport fail before connecting:

```sh
NODE_OPTIONS='--require ./scripts/block-outbound.cjs' npm test
```

On Windows PowerShell, set `$env:NODE_OPTIONS = '--require ./scripts/block-outbound.cjs'` before `npm test`, then remove it with `Remove-Item Env:NODE_OPTIONS`. The blocker permits local loader IPC pipes, not network connections.

## Browser journey

Install the Python Playwright package and its Chromium browser, then start a disposable demo with `npm run demo`. Run:

```sh
python3 scripts/test-browser.py
```

The harness refuses non-loopback targets, blocks browser requests outside the app, and records screenshots at 320, 390, 768 and 1440 pixels. It exercises real forms, stale shared-cookie tabs, anonymous capability isolation, calendar coverage/history, creation, confirmation, HTML/ICS previews and reopening. It mutates only the fictional local demo. Use `CONVERGE_TEST_ORIGIN` if you chose another local port.

For a stronger offline check, start the server with the network-blocking preload and fictional provider values, as the CI browser job does. The server and browser must both complete without outbound attempts. Do not use that blocker when installing dependencies.

## PostgreSQL contracts and hosted API

`tools/test-database.sh` accepts only loopback PostgreSQL databases named `converge_test` or `converge_contract_*`. Point `PGHOST`, `PGPORT`, `PGUSER` and `PGDATABASE` at a new disposable PostgreSQL 17 database. It applies the included migrations and runs the SQL contract and concurrent notification tests. It does not accept a production host or arbitrary database name.

`scripts/test-production.ts` separately tests the actual Supabase JavaScript client through HTTPS and a real PostgREST server against a new PostgreSQL 17 database. It initializes only an empty schema, creates signed **test sessions** instead of contacting Google, verifies application ownership/projections and SQL confirmation races, restarts the app, and checks browser-role database denial. It does not certify live OAuth consent, email deliverability or Gemini output.

Install PostgREST 16.3 or fetch its pinned official test binary with `python3 scripts/fetch-postgrest.py`. That downloader verifies the release checksum and supports Linux x86-64 and Apple Silicon macOS. The macOS binary also needs libpq; with Homebrew PostgreSQL 17, set `DYLD_LIBRARY_PATH` to its `lib/postgresql` directory if the binary cannot find libpq.

```sh
CONVERGE_TEST_DATABASE_URL=postgresql://test_owner@127.0.0.1:55432/converge_contract_api \
CONVERGE_TEST_POSTGREST=./artifacts/postgrest/postgrest \
node --import tsx scripts/test-production.ts
```

The test requires OpenSSL. Its self-signed local certificate is trusted only by the test child through an explicit CA file. TLS verification remains enabled. The temporary app/API processes and certificate files are stopped/removed afterward; the disposable database is left for your harness or service container to discard.

## Release packaging

`release-files.json` is the explicit, sorted source allowlist. Review every addition, update `licenses/npm-dependencies.json` and installed dependency notices with `python3 scripts/refresh-notices.py`, then run:

```sh
python3 scripts/build-release.py
python3 scripts/check-launchers.py
```

The first command produces a deterministic ZIP, a per-file SHA-256 manifest and a checksum file in `artifacts/`. The second extracts that ZIP into a folder with spaces and exercises the real desktop Start file, including installation and build. GitHub CI runs the release launcher on Linux, macOS and Windows and the core tests on Node 22/24.

Before publishing, inspect the exact source tree, asset provenance, history metadata and archive contents. Never include `.local`, `.env.local`, `.next`, provider linkage, logs, generated test output or private notes. The PNG hero and bundled fonts have their own provenance ledger; preserve upstream font/dependency notices.

## Useful contributions

Changes to calendar interpretation need clear invented edge cases: timezones and daylight saving, all-day exclusive ends, missing locations, partial calendars, ambiguous travel chains and adjacent conflicts. Identity/lifecycle changes need a failing reproduction before the fix, ideally at the HTTP/SQL boundary where the invariant is enforced. Preserve the offline demo and beginner instructions as the product evolves.
