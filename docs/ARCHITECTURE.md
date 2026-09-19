# How Converge is put together

> **Design:** one planner, two explicit operating modes. The same scheduling logic, SQL lifecycle, forms and notification formatters run in the local fictional demo and a hosted installation. Only identity and external transports change.

## Planning before integrations

`OrganizerFlow` starts with dates and duration. `DateExplorer` groups related start options, keeps a shortlist and exposes the exact underlying days. `scheduling.ts` and `analysis.ts` rank those options deterministically. Calendar connection is optional, and AI never chooses or scores the core dates.

Calendar normalization uses civil dates and IANA timezones. Timed events, exclusive all-day ends, canceled/declined/transparent events, duplicate occurrences, coverage failures and trip adjacency are handled explicitly. Travel inference is a heuristic: a flight title may suggest an away span, but repeated airport appearances do not establish someone's home. The new fictional regressions were written from behavioral requirements, not by renaming someone's itinerary.

## Identities and shared views

Signed-in account actors are HMAC-derived from provider subjects and a stable server secret. Typed email never proves ownership. Anonymous response slots use high-entropy capabilities; the browser captures a private URL fragment and removes it from the visible address. An explicit capability continues to select that response slot after an intentional calendar sign-in.

Each browser document carries the actor it originally displayed. Private API requests assert that actor, including an explicit anonymous state, and the server compares it with the signed session before reading or writing account-dependent data. A header is never authentication. This prevents a stale tab from saving one person's form under another account after a shared-cookie switch.

Public trip projection includes trip details and participant availability. It excludes organizer-only expected-person records, email addresses, actor keys, return capabilities, provider tokens and calendar details. The organizer is implicitly available once; self-responses are rejected by both the application and SQL mutation boundary.

## Durable state

`storage/port.ts` exposes a narrow set of queries and whitelisted RPCs. Hosted requests use Supabase's server-only client. Local mode uses PGlite, an embedded PostgreSQL engine, with the same migration functions. Nullable in-memory stores remain only as unit-test reference implementations when no operating mode is configured. They are never production fallback storage.

Local data uses a locked directory, instance marker and migration checksum ledger. Incomplete, mismatched or missing saved data is refused instead of reseeded. Migrations and their ledger entries commit together. Explicit owner migration commands perform upgrades; startup checks compatibility.

Planning revisions protect against stale organizer edits. Required respondents and expected people guide comparison. Confirmation versions protect reopening/reconfirmation. Reopening clears closed responses atomically, preserves prior confirmation history and increments the planning revision.

## Notifications and optional AI

The worker claims delivery leases, checks current confirmation versions, formats the actual HTML/text/ICS message and records acceptance. A durable preview outbox replaces SMTP locally. Hosted SMTP is optional and retains at-least-once semantics. Stable trip-scoped calendar UIDs and message identifiers survive a hostname change.

Calendar scans and history summaries use actor-scoped caches with leases and expiry. Gemini grouping is opt-in, input/output bounded and validated against submitted event IDs. SQL budget reservations coordinate concurrent generation; usage accounting remains an estimate of provider charges. Local grouping is clearly marked as simulated and does not call a model.

## Project map

| Area | Start reading here |
| --- | --- |
| Organizer experience | `src/components/converge/OrganizerFlow.tsx` |
| Respondent and management views | `JoinFlow.tsx`, `ManageTrip.jsx` |
| Date ranking and calendar interpretation | `src/lib/scheduling.ts`, `src/lib/calendar/` |
| Trip lifecycle and projections | `src/lib/store.ts`, `supabase/migrations/` |
| Runtime configuration and actor binding | `src/lib/runtime/`, `src/components/identity-fetch.ts` |
| Local persistence and owner tools | `src/lib/storage/`, `scripts/setup.ts`, `scripts/storage.ts` |
| Delivery recovery and previews | `src/lib/notification-worker.ts`, `src/lib/notifications.ts` |
| Synthetic identities and calendars | `src/lib/demo/` |

Keep changes in this reusable engine. Keep real credentials, contacts, event exports and saved databases outside the public source tree.
