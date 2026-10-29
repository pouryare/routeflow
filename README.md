# RouteFlow

RouteFlow is a field sales, delivery and route management web app for a distribution company. It covers the work from finding a customer to collecting the money: leads and customers on a map, orders, stock, delivery runs for drivers, payments and cheques, commission, and the company's books. The interface is in Persian, right to left, and built for phones first; desk screens follow.

The app is in development. All data in it is dummy, and there are no real users yet.

## What it does today

| Area | What is built |
|---|---|
| Customers and leads | Customer list and customer page (timeline, prices paid, owner history), leads and map pins, lead import, coverage map of districts (visited, needs coverage, not allowed), photo gallery, data quality list, complaints |
| Sales | Orders with discount approval, products and prices with a change log, payments and cheques, commission statements, a "today" screen and personal task pocket for reps, order priority flag |
| Delivery and stock | Route planner and routing (OSRM and VROOM), delivery schedule, a driver screen for today's run with receipts and proof, stock and purchasing, production batches |
| Reports | Sales summary and analysis, forecast, failure and cancellation reasons, lead sources, coverage report, realized and unrealized profit |
| Accounting | Double-entry ledger, journal, trial balance, balance sheet, income statement, expenses, payables, suppliers, shareholders and yearly profit split |
| Platform | Multiple companies in one database with row-level security, offline sync for sales and driver roles, push notifications, authenticator codes before sensitive actions, sign-in log, sign out everywhere, owner status page, in-app help and a training academy |

Maps use MapLibre over our own vector tiles of Tehran province, served by the app itself. No map request goes to a foreign host.

## Roles

Everyone signs in with their own account. There is no shared password.

| Role | Sees |
|---|---|
| `platform_owner` | Every company |
| `owner` | Everything in their company, including admin, accounting and analytics |
| `group_manager` | Their own group's customers, territory, orders and plans |
| `rep_manager` | Leads the sales reps: customers, map pins and the lead pool, without payments or complaints |
| `phone_sales` | Takes orders by phone for their own customers |
| `field_rep`, `delivery_driver` | The van roles: today's run on the driver screen, selling and collecting on the route, and training |
| `shareholder` | Only their own share page |

A row that belongs to another company or group answers 404, not 403, so the app never confirms that it exists. Roles are defined in `lib/roles.ts` and the navigation for each role in `lib/appNav.ts`.

## Stack

- Next.js 16 (App Router, TypeScript, Turbopack) on Node 22
- PostgreSQL 18, self-hosted, with PostGIS, `pg_trgm`, `btree_gist`, `pg_stat_statements` and `pg_duckdb`; queries through `pg` and Kysely; migrations with node-pg-migrate, linted by Squawk
- HeroUI v3 on React Aria for the interface (migration in progress), `lucide-react` icons
- MapLibre GL (`@vis.gl/react-maplibre`) with Protomaps tiles
- Vitest against a real PostgreSQL, Playwright for the browser smoke suite

The production server is in Iran, so everything is self-hosted and the app uses no paid foreign API or key.

## Running it locally

You need Node 22 and Docker (or your own PostgreSQL 18 with the same extensions).

```bash
npm install
cp .env.example .env.local                  # fill in SESSION_SECRET at least
docker compose -f db/compose.yml up -d      # PostgreSQL on 127.0.0.1:5432
export DATABASE_URL=postgres://routeflow:routeflow@localhost:5432/routeflow
npm run db:pg:migrate                       # apply the migrations
npm run dev                                 # http://localhost:3000
```

### Demo data

```bash
npm run seed:demo      # builds a demo company in its own database (routeflow_demo)
npm run dev:demo       # runs the app against it
```

Every demo login gets the password in `DEMO_PASSWORD`. If it is empty, the seed makes a random one and prints it.

### The first owner account

Accounts are managed in the app by an owner, so the very first owner is made from the command line:

```bash
node scripts/create-user.mjs <username> <password> "<Display Name>" owner
```

Other roles that belong to a group take the group id as a fifth argument. The same script is the way back in if every owner password is lost.

## Checks

| Command | What it checks |
|---|---|
| `npm test` | Unit and database tests, each test file on its own copy of a template database (needs `DATABASE_URL`) |
| `npm run test:smoke` | Browser smoke suite on a disposable database |
| `npm run typecheck`, `npm run lint` | Types and lint |
| `npm run check:mobile` | Mobile-first rules: no native `<select>` or date input, tap targets of at least 44 px, a test for every mobile component |
| `npm run check:architecture` | Architecture rules against `docs/architecture-baseline.json` |
| `npm run db:pg:lint` | Squawk on the migrations |

CI runs these on pull requests that are ready for review. Draft pull requests and changes to docs only do not run CI.

## Configuration

`.env.example` lists every variable the app reads. Real values never go in this repository; they are kept in a separate private repository and written to the server's environment at deploy time. The main ones are `DATABASE_URL`, `SESSION_SECRET`, `PG_APP_ROLE` (the database role that row-level security applies to), `DEMO_PASSWORD`, `CONTACT_EMAIL`, and the Telegram and web push (VAPID) keys.

## Deployment

The app runs on one server with PostgreSQL on the same machine, behind Caddy (a CDN can sit in front; map tiles are cacheable). Backups are taken by pgBackRest to the local disk and to a second machine, with a monthly restore drill.

- Server setup, backups and restore: [`docs/postgres-server.md`](docs/postgres-server.md)
- Database development notes, row-level security and sync: [`db/README.md`](db/README.md)
- Building and serving the map tiles: [`docs/map-tiles.md`](docs/map-tiles.md)
- Caddy block template: [`deploy/Caddy-snippet.txt`](deploy/Caddy-snippet.txt)

## Roadmap and future features

What comes next is planned in two documents:

- [`docs/future-features.md`](docs/future-features.md) holds about 150 parked feature ideas (F1 to F148). Each is parked until it gets its own spec; nothing there is promised.
- [`docs/roadmap.md`](docs/roadmap.md) groups those ideas by theme, estimates the size of each first slice, lists the decisions that block them, and records the platform decisions.

The current direction, in order:

1. **UI pattern batches.** Batch A (discount approval and authenticator codes) is built. Next are quick wins (haptics, one button-state rule, validation on leaving a field), forms that keep your work (drafts, unsaved-changes bar, optimistic updates), faster find-and-act (actions in Ctrl-K, pinned pages, a shared selection bar, a first-use tour), then denser desk layouts.
2. **Foundations.** A shared audit record (F27), one approval request shape (F48), session security and two-step login (F107, F106), purchase orders (F66), and the customer message channel, starting with SMS through Farazsms.
3. **Money and orders.** Payment terms, payment promises, customer statements, credit-risk scoring and a cash-flow forecast; order templates and standing orders; one pricing rule for price lists, minimums and promotions; backorders and credit holds.
4. **Delivery and stock.** Delivery time windows, proof of delivery and confirmation codes, returns, van loading and bin locations, supplier deliveries, a capacity warning.
5. **Heavier or external work.** An Android app as a Capacitor shell (for background GPS, barcode scanning and Bluetooth printing), live driver tracking, telephony, bank statement import, reading cheques and invoices with the camera, more offline coverage, a Telegram bot with approvals, and report builders.

Platform work planned alongside: a background job worker (pg-boss), photos in object storage, and an off-site backup copy. Several features wait on an owner decision first, such as customer consent for messages, how staff positions are kept, and the Android distribution route; these are listed in section 5 of the roadmap.

## Documentation

| Document | About |
|---|---|
| [`docs/mobile-first-principles.md`](docs/mobile-first-principles.md) | How phone screens are built; read before any UI work |
| [`docs/tap-flow-principles.md`](docs/tap-flow-principles.md) | Flows that record what just happened in a few taps |
| [`MASTER.md`](MASTER.md) | The design system |
| [`docs/crm-erp-plan.md`](docs/crm-erp-plan.md) | The original CRM and ERP plan |
| [`docs/company-and-shareholders.md`](docs/company-and-shareholders.md) | Company, shareholders and profit split in the books |
| [`TODO-REPORT.md`](TODO-REPORT.md) | What is done, known gaps and next steps |
| [`CLAUDE.md`](CLAUDE.md), [`AGENTS.md`](AGENTS.md) | Rules for contributors and coding agents |

## Licence

All rights reserved. The source is published for viewing only; see [`LICENSE`](LICENSE).
