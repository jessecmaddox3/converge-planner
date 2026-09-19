# Run Converge for your own group

> **Plan:** Use a persistent Node server behind HTTPS, your own Google sign-in project and an empty Supabase database. The app refuses missing production configuration. Start with email and AI disabled, verify sign-in and planning, then enable either feature deliberately.

This guide is for someone comfortable managing a server and private configuration. The one-computer [demo](GETTING_STARTED.md) is the easiest way to evaluate the complete product first. A demo link cannot be shared over the internet, and demo identities must never be exposed as public authentication.

## 1. Install the application

Use the tagged release on a Node 22 or 24 host. Download and extract the release ZIP, or clone and check out its tag, then run `npm ci`. Use `npm start` for the validated production server. The desktop Start files always choose the fictional local demo.

Copy `.env.example` to `.env.local` and replace every placeholder with values from your own setup. The example contains no working credentials. Do not commit that file, upload it in an issue or put service keys in `NEXT_PUBLIC_` variables.

## 2. Create an empty Supabase database

Create a dedicated Supabase project. The initializer requires an empty `public` schema, including no existing functions, tables or other schema objects. It will not adopt an unrelated database. Built-in Supabase schemas can remain present.

From your project settings, obtain the HTTPS API URL and server-side service-role key. Put them in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The browser never receives this key.

For the owner setup command, obtain the PostgreSQL **direct or session-pooler connection string**, including your database password, and put it in `DATABASE_URL`. Use the session pooler if your network cannot reach the direct IPv6 endpoint. Do not use a transaction-pooler connection for migrations. These connection options are described in [Supabase's database connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres).

Remote database connections require verified TLS. If your provider needs a CA file, set `CONVERGE_DATABASE_CA_CERT` to its path. Keep certificate verification enabled.

```sh
npm run setup -- init
npm run setup -- status
```

The owner command applies the eight included migrations and records their checksums in one ledger. It needs the standard Supabase `anon`, `authenticated` and `service_role` database roles. It checks browser-role access and prints no records. Runtime startup verifies the required schema through a service-only RPC and does not apply migrations itself.

`DATABASE_URL` and a custom database CA are owner-maintenance settings. The running app uses the Supabase service API, so remove the owner connection string from the runtime environment if the server does not need to perform maintenance commands.

## 3. Configure Google sign-in

Create an OAuth web client in your own Google Cloud project and configure its consent screen. Enable the Google Calendar API if you want calendar checks. Set the authorized callback to your exact app address followed by `/api/auth/callback/google`, for example:

```text
https://trips.example.org/api/auth/callback/google
```

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Converge requests identity/profile access and read-only Calendar access. Calendar data is accessed on the server; access and refresh tokens are excluded from public session JSON. Google's consent/testing restrictions still apply to your project. Follow the [NextAuth Google setup notes](https://next-auth.js.org/providers/google), including refresh-token behavior and test-user access.

Generate a different strong random value for each of `NEXTAUTH_SECRET`, `ACTOR_KEY_SECRET` and `CRON_SECRET`. Run this command separately for each value and save the output privately:

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Keep `ACTOR_KEY_SECRET` stable and include it in your private recovery plan. It maps Google identities to their trip ownership. Changing it without an ownership migration makes existing accounts appear to be different people. A session-secret change signs users out; it does not replace the actor secret.

## 4. Set your installation identity

Use `CONVERGE_MODE=production`. Set `CONVERGE_ORIGIN` and `NEXTAUTH_URL` to the same HTTPS origin, without a trailing slash or path. Set `CONVERGE_OPERATOR` and `CONVERGE_CONTACT` to the name and contact address that should appear in **your** privacy page.

Choose a stable DNS-style `CONVERGE_NAMESPACE`, usually your hostname. New trips freeze this value for calendar UIDs and email Message-IDs; a later hostname change does not alter an existing trip's event identity. The canonical origin provides links in outgoing messages.

Set `PORT` to the Node listening port. By default the Node server binds `127.0.0.1`; use `CONVERGE_BIND_ADDRESS=0.0.0.0` only if your container or reverse proxy requires it. Terminate HTTPS at your proxy and forward the original `Host` header and `Origin`. The app rejects requests addressed to another host and cross-origin mutations.

```sh
npm run build
npm start
```

Confirm your HTTPS address opens, sign in with a test user you control, create an invented plan, and view it from another account or anonymous browser. Do not point this new installation at an existing private application database without a separately planned migration.

## 5. Optional confirmation email

With no mail configuration, the app still confirms dates and downloads calendar files. Delivery remains disabled. To send confirmation messages, configure your SMTP provider with `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` and `CONVERGE_MAIL_FROM`.

Use `SMTP_SECURE=yes` for implicit TLS, commonly port 465. Otherwise the transport requires STARTTLS, commonly port 587. Authenticate and verify the sender with your provider. The original Gmail app-password path remains available via `GMAIL_USER` and `GMAIL_APP_PASSWORD` if generic SMTP is not configured.

Review a message using addresses you control before inviting a group. Delivery jobs use leases, retries and confirmation versions. An ambiguous SMTP failure can cause a duplicate on retry; “sent” means the provider accepted it, not that the recipient read it. No invitation email is sent merely by creating a plan: share the response link yourself.

## 6. Optional history grouping with Gemini

Manual planning, deterministic date ranking and calendar checks do not require AI. To enable the explicit **Group related events** action, set `CONVERGE_ENABLE_AI=yes`, your own `GEMINI_API_KEY` and `AI_DAILY_BUDGET_USD`.

The default model is `gemini-3.5-flash-lite`. The budget estimator uses $0.30 per million input tokens and $2.50 per million output tokens including thinking, matching [Google's standard pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite) checked September 19, 2026. Provider prices, model availability and policies can change. Review those settings before enabling it. This application budget is an estimate with reservations, not a provider-enforced billing cap. Also set limits in your provider account.

Only the explicitly submitted history events go to the model; grouping output is validated against those event IDs. Review the original events, since plausible grouping is not proof of an activity. The local demo uses labeled simulated grouping and never calls Gemini, even if keys are present in the environment.

## 7. Schedule maintenance and backups

Configure a trusted scheduler to send a GET request to `/api/internal/notifications` with `Authorization: Bearer YOUR_CRON_SECRET` at least every 15 minutes. Keep the real header secret in your scheduler, not in source files. This endpoint retries queued confirmations and removes expired caches and old usage counters. Monitor non-200 responses.

The included `vercel.json` records that cron schedule for people adapting the app to Vercel. The verified self-hosting entry point is the Node server above. A framework deployment still needs the same explicit production configuration, separately initialized Supabase database, approved OAuth callback and working scheduler. Do not substitute demo mode when hosting configuration fails.

Trips, answers and delivery history do not automatically expire. The cleanup job removes expired scan/grouping caches, rate counters older than two days and AI usage/budgets older than 30 days. The local demo runs maintenance once a minute while open. Hosted retention depends on the scheduler actually running. Database backups and provider logs have separate retention policies.

Use native PostgreSQL/Supabase backups for production and protect your actor secret, configuration and any mail settings separately. Practice restoration in an isolated installation. See [BACKUPS.md](BACKUPS.md) for the distinct local-demo backup procedure. There is no self-service account deletion interface in this release; as operator, handle access and deletion requests yourself.
