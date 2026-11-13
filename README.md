# GarageOS

GarageOS is a React + TypeScript workshop operations app backed by Neon Postgres and Neon Auth. The browser talks to Neon Auth and the server-side `/api/garage` endpoint; database credentials stay on the server.

## Run locally

1. Create a Neon project with Neon Auth enabled and copy `.env.example` to `.env.local`.
2. Configure these values in `.env.local`:
   - `DATABASE_URL`: pooled Neon connection string, used by the API.
   - `DATABASE_URL_UNPOOLED`: direct connection string, preferred for migrations.
   - `NEON_AUTH_BASE_URL`: Neon Auth base URL.
   - `NEON_AUTH_JWKS_URL`: `${NEON_AUTH_BASE_URL}/.well-known/jwks.json`.
   - `VITE_NEON_AUTH_URL`: the same public Auth base URL.

   Keep both database URLs server-only; never prefix them with `VITE_`.
3. Before applying the schema, verify that `neon_auth."user"` exists with UUID IDs. The migration creates a no-login, non-bypass `garageos_app` role, grants the migration role permission to assume it, and grants only the required application privileges. The API assumes `garageos_app` within every request transaction so the forced RLS policies apply. Then apply the migration:

   ```powershell
   npm run db:migrate
   ```

   The runner records applied migrations in `garageos_meta.schema_migrations`. Review `db/migrations/0001_garageos.sql` before applying it to an existing database.
4. Install dependencies and start the app:

   ```powershell
   npm install
   npm run dev
   ```

The first account that initializes a new workspace becomes its owner. Configure Neon Auth email verification and delivery for your branch; staff invitations require a verified email.

## Deploy

- **Vercel:** set `DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL`, and `VITE_NEON_AUTH_URL`. Set `DATABASE_URL_UNPOOLED` only where migration execution is needed. Vercel serves the API function and the Vite SPA.
- **WhatsApp (optional):** set `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_GRAPH_API_VERSION`, and `WHATSAPP_TEMPLATE_NAME` as server-only variables; `WHATSAPP_LANGUAGE_CODE` is optional. Configure the approved Meta template expected by the API, then set `VITE_WHATSAPP_NOTIFICATIONS_ENABLED=true`. The application reports Meta's API acceptance, not final delivery.

## MVP workflows

- Neon Auth sign-in and workshop setup, plus role-based team invitations.
- Customer creation, editing, search, archive, registered vehicles, job counts, and outstanding balances.
- Vehicle registration with case-insensitive duplicate prevention.
- Repair job cards with mechanic assignment, status updates, and status history.
- Customer appointments and upcoming schedule.
- Parts registration, low-stock alerts, and atomic job usage; stock cannot be reduced below zero.
- Invoices, printable invoice summaries, cash / bank-transfer / M-Pesa payment records, and atomic balance updates.
- Revenue charts, date-filtered payment reports, and CSV export.
- Workshop-scoped relationships, forced Row Level Security on application tables, and audit events.

## Current scope

The migration and Neon-backed workflows still require validation against the target Neon project before production use. Vehicle photo upload, itemized quotations, customer approval links, stock-adjustment screens, maintenance reminders, mechanic time/profit reporting, and WhatsApp delivery-status webhooks are not currently implemented. Staff invitations create one-time links but do not email them automatically.

Before production use, validate the Auth schema and database role, apply the migration to the intended Neon branch, review the RLS policies, configure backups and monitoring, and test authentication, tenant isolation, stock, payments, Vercel routing, and any enabled WhatsApp integration end-to-end.
