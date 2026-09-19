# Third-party notices

Original Converge code is MIT licensed. Dependencies retain their own licenses in the installed packages and lockfile.

## Fonts

Unmodified Fraunces and Plus Jakarta Sans fonts are bundled for offline use, with their complete original SIL Open Font License 1.1 notices in `public/fonts/`. Sources are the official Google Fonts repository at commit `f2bd09badbc763d8757951d52deec29da27e85fb`:

- https://github.com/google/fonts/tree/f2bd09badbc763d8757951d52deec29da27e85fb/ofl/fraunces
- https://github.com/google/fonts/tree/f2bd09badbc763d8757951d52deec29da27e85fb/ofl/plusjakartasans

Exact file hashes and source URLs are in `docs/assets/provenance.json`. The app does not fetch fonts from Google when you open it.

## Illustration and examples

The hero was generated with ChatGPT from a wholly invented description. Its original bytes, prompt summary and provenance hash are retained in `docs/assets/`. No reference photo or personal records were used. All shipped demo people, calendars, trips and test scenarios are fictional; arbitrary airport parser tokens are not geographic reference data.

## Dependencies and test tooling

`licenses/npm-dependencies.json` inventories every locked npm package with its declared license, source archive and integrity value. Complete notice files from installed packages are preserved under `licenses/npm/`; npm also distributes each dependency's own notices. Platform-specific optional packages that are not installed on the inventory host are identified in the ledger and retain their upstream license when npm installs them.

The optional production integration harness downloads an unmodified official PostgREST test binary into ignored `artifacts/`, checks its pinned digest, and does not bundle it in the Converge release. Its upstream project is https://github.com/PostgREST/postgrest. PostgreSQL, OpenSSL and Python Playwright are separately installed test tools.
