# Lead-run assign lifecycle — plan

**Spec:** `docs/superpowers/specs/2026-09-27-lead-run-assign-lifecycle-design.md`
**Status:** implementing

## Shape of the change

One write, from one place. Today `LeadRunPlannerTabFlow` can reach `assign()` two ways —
`onSaved` and a `submitOption` the auto-submit effect calls — which is why a confirm could
fire two POSTs. Removing the auto-submit collapses that to a single path, and the 5 s undo
window is inserted *before* it.

```
tap ثبت و سپردن
  ├─ toast(info, «لغو») + setTimeout(OUTBOX_HOLD_MS)
  ├─ لغو  → clearTimeout → nothing was ever sent
  └─ timer → api.submit("confirm") → flow.saved → onSaved → assign()   ← the only write
```

The flow is *not* advanced on tap. Advancing would flip `saved` and show the done screen
during the window, so a cancel would have to un-save a state machine. Holding on the confirm
screen instead means the manager watches the summary they are about to commit, with a
cancelling bar over it.

## Tasks

1. **`LeadRunPlannerTabFlow.tsx`** — drop `submitOption` / `atConfirm` / the auto-submit
   effect / the button drain; add a `holding` state and `beginHandover`, which starts the
   toast and the timer together. Clear the timer on unmount. `onSaved` keeps its single
   `assign()` call. Import `OUTBOX_HOLD_MS` rather than a local `5000`.
2. **`page.tsx`** — `onAssigned` calls `updateRun([])` and records the receipt; drop
   `onTapFlow`, the two dead day-split props, and the unused `RunPanel` import; take
   `unassignedLocations` from the hook instead of rebuilding it per render.
3. **`useLeads.ts`** — return the `unassignedLocations` it already computes; make
   `openList` intersect saved ids with those that still resolve, closing the #5 pre-flight
   gap.
4. **`RouteSection.tsx`** — replace `RoutableLocation = any` with the real type; give the
   editable day groups the two actions the automatic split already has; render the
   last-assigned line; drop the dead props.
5. Verify: `tsc --noEmit`, the suite, the production build.

## Decisions taken during implementation

- **The hold applies to overrides too.** The old code skipped the timer for an override,
  but that was skipping an *auto-submit* — a write nobody chose. Here the person has already
  tapped the button, and the 5 s is an undo window rather than a delay, so it is uniform.
- **Cancel needs no second toast.** `ToastProvider` dismisses the toast that owned the
  action, so `لغو` needs no confirmation of its own.
