# lib/repo

The only place in the codebase where **new** raw SQL is allowed.

- New feature code talks to the database through a repo module here, never
  `getDb().prepare(...)` in a route or a `lib/` file outside this folder.
- `tests/repo-boundary.test.ts` enforces it: any `.prepare(` or `.exec("<sql>")`
  in a file under `app/` or `lib/` fails the build unless the file is under
  `lib/repo/` or listed in `tests/fixtures/raw-sql-allowlist.txt`.
- That allowlist is the ~69 files that predate this rule (Phase 0b). It **only
  shrinks** — the test rejects any path added versus `git HEAD`. When a later
  phase touches one of those files, move its queries into a repo module and
  delete the line. The test also flags stale entries (files since deleted).
- Every tenant repo (`makeRepo(table, { tenant: true })`) takes `organizationId`
  as its required first argument and applies `WHERE organization_id = ?` on every
  read and stamps it on every write. A forgotten scope is a compile error at the
  call site, not a silent leak.
- Every call on a `Db` returns a Promise (`await db.prepare(sql).get(...)`), so the
  PostgreSQL adapter can sit behind the same interface (`lib/database/client.ts`).
  Several writes that must land together go in `await db.tx(async () => { ... })`,
  never a hand-written `BEGIN`/`COMMIT`. SQL that SQLite and PostgreSQL spell
  differently goes through `lib/database/dialect.ts`.

## Using it

```ts
import { makeRepo } from "@/lib/repo/base";

interface WidgetRow { id: number; name: string; /* ...columns... */ }
export const widgetsRepo = makeRepo<WidgetRow>("widgets", { tenant: true });

// In a route:
const widget = widgetsRepo.get(session.organizationId, id);            // scoped read
const newId = widgetsRepo.insert(session.organizationId, { name });    // organization_id stamped
widgetsRepo.patch(session.organizationId, id, { name: "renamed" });    // scoped write
```

For a read `base.ts` cannot express, hand-write it *in the repo module* using
`widgetsRepo.db()` and keep the `WHERE organization_id = ?` yourself.
