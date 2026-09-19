---
name: plan-converge-trip
description: Help someone set up Converge, choose candidate trip dates, compare group availability, or adapt the planner for their own group.
---

# Plan a trip with Converge

Use the complete planner in this repository. For a first-time user, follow [Getting started](../../docs/GETTING_STARTED.md). The Start files install dependencies, build the app and open its fictional local demo. That demo stays on one computer; its links do not invite real guests and its outbox does not send mail. For a real group, follow [Hosting](../../docs/HOSTING.md) with the user's own accounts and configuration.

## Turn an idea into useful options

Reuse the user's stated trip length, date range and constraints. In the organizer flow, choose weekends, single days, full weeks or a custom duration. Browse alternatives before adding a manageable shortlist. Optional calendar checks belong to the person whose calendars are connected. Inspect partial coverage and travel conflicts; an unchecked or inaccessible calendar is not evidence that someone is free. Historical grouping in the demo is explicitly simulated. Hosted AI grouping is optional and does not determine date ranking.

Add the people whose answers are expected and distinguish required from optional participants. Share the response link through a channel the user has authorized. The link exposes trip details, participant names and availability to its holders. Keep private calendar titles and contact addresses out of public examples, screenshots and issue reports.

## Help the group decide

Available, Maybe, Cannot and unanswered are four different states. Do not turn a missing answer into an acceptance. Compare required participants first, then the whole group and favorite choices. Describe the actual tradeoff when no date fits everyone. An anonymous respondent's private return link permits editing their response; preserve it privately.

Confirm a date only when that choice is authorized. Confirmation is a planning decision, not a booking or an attendance RSVP. The downloaded calendar file must be imported by its recipient; Converge does not write directly to Google Calendar. In the demo, inspect the local outbox. In a hosted installation, email is optional and delivery retries can produce duplicates after an ambiguous provider failure.

If plans change, use the organizer's reopen workflow, gather revised answers and confirm the new version. Do not edit database rows to bypass the trip lifecycle.

## Adapt or maintain the app

Read [Architecture](../../docs/ARCHITECTURE.md) before changing scheduling, anonymous capabilities, storage or delivery. Preserve server-side ownership checks and the current actor consistency check across tabs. Use [Development](../../docs/DEVELOPMENT.md) for the existing offline, browser and database tests. Use [Backups](../../docs/BACKUPS.md) before an upgrade or restore; a local demo backup is not a hosted database backup. Keep personal state and provider credentials outside contributions.
