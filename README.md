# Pennywise

A private monthly income and expense tracker built with Next.js, Supabase, Tailwind CSS, Recharts, and Lucide React.

## Setup

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL Editor.
3. Run [`supabase/sharing.sql`](supabase/sharing.sql) in the Supabase SQL Editor to enable view-only ledger sharing.
4. Copy `.env.local.example` to `.env.local` and enter your Supabase project URL and anon key. Amounts are displayed in Indian rupees (INR).
5. Add `SUPABASE_SERVICE_ROLE_KEY` to `.env.local` for the server-side sharing API. Keep it private and never use a `NEXT_PUBLIC_` prefix.
6. In Supabase Authentication settings, configure email sign-up and confirmation to your preference.
7. Start the app:

```powershell
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), create an account or sign in, and start adding entries. The anon key is intended for browser use; row-level security policies restrict each transaction to its owner. Never expose a Supabase service-role key in a `NEXT_PUBLIC_` variable.

The dashboard shows both the selected month's net balance and a cumulative **Balance to
date** through that selected month, including prior months. Negative income entries reduce
both totals.
Use the **All**, **Credit**, and **Expense** controls in the monthly ledger to filter its
displayed transactions. Credit includes both positive income and negative loss entries.
Use the trash icon on a ledger row to open a confirmation dialog before permanently
deleting that transaction.

Use **Share access** to grant an existing Pennywise account view-only access by email or
revoke that access later. Shared users must sign in with the matching account and select
the shared ledger in the top bar. Database row-level security keeps transaction inserts,
updates, and deletes restricted to each ledger's owner; sharing grants read access only.

### Recording a loss

In the Income form, enter a negative amount to record a loss. It reduces that month's
income and net balance, and appears as a negative amount labeled "Loss". Expenses must
remain positive. To enable this on an existing Supabase database, run
[`supabase/allow-negative-credit.sql`](./supabase/allow-negative-credit.sql) once in the
Supabase SQL Editor. The main schema also includes this constraint for new databases.

## Checks

```powershell
npm run lint
npm run build
```

## Importing transactions from Excel

The root-level [`migrate.js`](./migrate.js) script imports transactions from `tracker.xlsx`.
The required packages are `xlsx`, `@supabase/supabase-js`, and `dotenv` (already included
in this project's dependencies). To install them in a fresh checkout:

```powershell
npm install xlsx @supabase/supabase-js dotenv
```

Place `tracker.xlsx` in the project root. Set `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` in `.env.local`, then replace the `USER_ID` placeholder in
`migrate.js` with the target Supabase Auth user's UUID. Keep the service-role key private;
it bypasses row-level security and must never be exposed in client-side code or committed.
Run the migration from the project root:

```powershell
node migrate.js
```

The script processes only the configured month sheets, reports skipped rows and insert
progress, and batches inserts. Its current year mapping is DEC 2025 and JAN–OCT 2026.
It infers the date from each worksheet row's position (first worksheet row is day 1),
capped at the actual last day of that month (up to day 31); skipped rows do not change
later row dates. If both credit and debit amounts are positive in one row, both are
imported as separate transaction records.
Only columns A–C are used for transactions; summary phrases and values in column D
onward are ignored when a positive credit or debit is present, so mixed transaction
and summary rows keep their A/B transaction amounts. Rows without positive A/B amounts
are skipped when they contain a summary phrase or have empty/zero amounts.
