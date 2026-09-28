# Leads assignment awareness — plan

**Spec:** `docs/superpowers/specs/2026-09-27-leads-assignment-awareness-design.md`

## Deliberate deviation from the spec

The spec says a new endpoint `GET /api/lead-runs/assignments`. This uses
`GET /api/lead-runs?assignments=1` instead, matching the `?drivers=1` branch already in that
file — one guard, one route file, one place that decides who may read runs. The returned
shape is identical either way; only the URL differs from the spec.

## Order

1. `readLeadRunAssignments` in `lib/repo/leadRuns.ts` + tests — the one join, `status != 'done'`,
   scoped to group for a manager and org for an owner, newest first.
2. The `?assignments=1` branch in the API route.
3. `assignedToAnotherDriver` in the same repo file + tests — the 409 guard, inside the
   existing transaction so a rejection writes nothing.
4. `useLeads`: fetch alongside locations and lists, build one `Map`, add the toggle, filter
   `routable`/`visible`/`mapLeads`/counts, and refuse `addToRun` for an assigned lead.
5. `LocationCard` gains an optional `assigned` prop, rendered in the existing chip row. One
   prop covers مختصر، شبکه‌ای، کانبان، گروهی and خوشه‌ای. `PoolViewWrapper` plumbs it through
   `shared`.
6. جدولی gets the same information as a column.
7. `createList` loses its `setRun`/`setActiveListId`; **ذخیره به‌عنوان فهرست** disables on an
   empty day.
8. `LeadListsBar` — a `CollapsibleSection` above the pool, wired to the `openList`,
   `renameList` and `deleteList` that already exist and are currently unreachable.
9. The proposal reduction as a pure function + tests.
10. Verify: tsc, the suite, the build.

## Notes for the implementation

- The filter belongs in `useLeads`, not in each consumer. The split inheriting it is the whole
  point: a pool that hides a lead while the split still offers it is the bug being fixed.
- The filter must never touch `proposedDaysRaw`. A proposal is a draft being shaped; a
  hand-over edits it through the explicit reduction in step 9 instead.
- `done` routes release their leads. The client predicate and the server SQL use the same
  `status != 'done'`, which is what keeps them from disagreeing.
- The hidden-count line is always present, so the pool never hides by silence.
- `stopsPerDay` (`lib/clusterDays.ts`) is uncommitted from the previous change and is
  unrelated to this work. It lands separately.
