# Facilities and the place picker

**Date:** 2026-10-04
**Status:** design approved in conversation; awaiting spec review
**Part of:** a three-spec sequence. Spec 1 (`2026-10-04-schedule-runs-view-design.md`) is
the runs view. Spec 3 is from/to inventory stops on routes. **This is spec 2, and spec 3
depends on it** — a facility has to be pickable before it can become a route stop.

---

## 1. Why this exists

Three findings, each verified against the source rather than inferred.

**1. Facilities are hard-coded, with real addresses in them.** `lib/db.ts:4870` seeds two
rows on every boot:

```
warehouse-bakeh   انبار مرکزی    استان تهران، بکه، بلوار رسول اکرم، املاک طاها
home-pardis       خانه (انبار کوچک)  تهران، پردیس، فاز ۲، خیابان فهمیده
```

with coordinates to seven decimals, Google Maps URLs, and `organization_id` pinned to `1` —
the comment reads *"these are the one real company's warehouse and home base, hardcoded
above by address."* `home-pardis` carries `is_default_origin: 1` and the note *"this is the
point every distance in the app measures from."* Two tests assert the slugs.

**2. Two places are invented at Null Island.** `lib/repo/stock.ts:384` auto-creates an
«انبار» with `lat 0, lng 0` when an organisation has none. `lib/repo/vanStock.ts:38` inserts
**every van** at `lat 0, lng 0`. Both do it because `facilities.lat` and `lng` are `NOT NULL`
(db.ts:1818) and there is no legal way to say "not placed yet".

**3. The place picker on `/leads` is a dead button.** `LocationPinPicker` is imported at
`app/(shell)/leads/page.tsx:26` and `showManualPos` is destructured at line 45 — and
neither is ever rendered. Pressing «تعیین موقعیت» sets state that nothing reads. Worse,
once `sortAnchor` is set the button is replaced by the plain text «نزدیک‌ترین» with no
clear and no way to change it, and `useLeads.ts:88` sets `sortAnchor` from GPS on load — so
**with location working, the button never even renders.** `/leads` hand-rolled its own
toolbar instead of using `SearchBox`, which does this correctly (`SearchBox.tsx:470-490`:
a chip with an ✕ to clear, plus a separate «خودم»).

There has never been a facility-picking mode at all. `LocationPinPicker` wraps
`LocationEditor`, which is a map pin and nothing more.

## 2. The rule

> **Every place is made through the app, by a person. Nothing is invented, and nothing is
> seeded.**

A facility is a **name plus, optionally, a location**. "Not placed yet" becomes a real,
storable state rather than a lie told as `0, 0`.

## 3. How the business actually works

Recorded because an earlier draft of this spec got it wrong, and the wrong version produced
a bad recommendation:

- **Bākeh dispatches.** A driver loads there and delivers the east side of Rud-e Hen and
  Pardis.
- **The founder's house receives returns.** Extras are unloaded there.
- The founder is not unusual in *using* his house as an inventory — he is unusual in being
  the only tenant for whom that is the normal arrangement. Other organisations do not.

These are two places doing two different jobs. Neither is "the main inventory" by
definition; **which facility a run loads from is a per-run choice** (§8).

## 4. Data

### 4.1 `facilities` changes

| column | now | becomes |
|--------|-----|---------|
| `lat`, `lng` | `NOT NULL` | **nullable** — "not placed yet" is legal |
| `kind` | CHECK of 4, of which `van` is absent from the TS type | the 9 kinds in §5 |
| `icon_key` | — | **new**, `TEXT`, the icon chosen for this facility |
| `owner_username` | exists, **read by nothing** | whose home this is (§7) |
| `is_default_origin` | read by 5 places | unchanged, but see §8.4 |

The per-tenant rebuild in `lib/db.ts` owns the migration. It must rebuild `facilities` the
way it rebuilds `products` — the table has real rows with movements pointing at them, so
`order_lines`-style re-pointing is not optional and `foreign_keys` cannot simply be off.

`FacilityRow.lat` becomes `number | null`. Every reader must handle it. The ones that
matter: `lib/facilities.ts:66,70,82`, `lib/repo/coverageAnalytics.ts:106`,
`components/CoverageMap.tsx:1107`. Customer locations already carry `lat: null`, so the
pattern is established.

### 4.2 Slugs stop being authored

`slug` is `UNIQUE NOT NULL`, and today it is hand-authored: `warehouse-bakeh`,
`home-pardis`, and `van-${organizationId}-${plate}` for vehicles.

People must not be asked to write slugs, and Persian names slugify badly. So:

- **Vans keep their slug exactly as they are** — the plate is a genuine natural key, and
  `createVanFacility`'s idempotency on it is load-bearing (two registrations of one plate
  must not split its stock across two balances).
- **Every other facility derives its slug** from a generated key, and the *name* becomes the
  human-facing field. A uniqueness conflict on regeneration appends a counter; it is never
  surfaced to the user, because they never see a slug.

This is why removing `FACILITY_SEED` is safe rather than destructive: those two rows were
never addressable by their names, only by slugs nothing else referenced.

### 4.3 What is deleted

| deleted | why |
|---------|-----|
| `FACILITY_SEED` and `seedFacilities` | the rule in §2 |
| `stock.ts:384` auto-create «انبار» | a place nobody chose |
| `createVanFacility`'s `0, 0` (vanStock.ts:38) | see §6 — vans never store a location |
| the two tests asserting `["home-pardis", "warehouse-bakeh"]` | they pin the removed seed |

`createVanFacility` **survives** — the stock ledger keys on a facility per van, and vans
must keep being idempotent on the plate. Only its fabricated coordinate goes.

## 5. Kinds and icons

Nine kinds. **Every one is a label today** — none branches logic (§5.2).

| kind | فارسی | icons offered |
|------|-------|---------------|
| `warehouse` | انبار | crates · building-with-door · silo |
| `factory` | کارخانه | factory · gear |
| `van` | ماشین | van · truck |
| `home` | خانه | house · apartment |
| `office` | دفتر | office · desk |
| `shop` | فروشگاه | shopfront · shelf |
| `cold_storage` | سردخانه | snowflake · cold-room |
| `parking` | پارکینگ | parking-lot · truck-parked |
| `other` | مکان دیگر | pin · plain-marker |

`home` replaces `home_base`, which read as *company base camp* rather than *a person's
house*. `parking` is a place a van actually lives, which a warehouse is not. `other` is
the escape hatch and stops duplicating the warehouse silhouette.

### 5.1 The icon is a property of the facility

Not of the kind. The kind **offers a set**; the user picks one; the choice is saved.

```
lib/facilityIcons.ts
  FACILITY_ICONS: Record<FacilityKind, FacilityIcon[]>
  iconFor(facility: FacilityRow): FacilityIcon   // icon_key, else the kind's first
```

This deliberately reverses the decision recorded at `components/facilityArt.ts:22-24` —
*"inventing a third form for a kind with no distinct meaning would add a symbol the legend
has to teach for no gain."* That was right when the icon was per-kind. It is wrong now:
with a choice per facility, the kind narrows the field rather than fixing the picture, and
**adding a kind later never invalidates icons already chosen.**

The existing `facility-marker__body` / `facility-marker__glyph` CSS contract is kept, so
every new icon draws against `--facility` and `--bg` and no colour is duplicated.

### 5.2 What a kind actually does

Traced: **eleven** reads of `kind` exist in the whole codebase, and every one asks one of
two questions — *"which place is the home base?"* or *"which place is the depot?"*
(`vanStock.ts:133`, `stock.ts:374-375`, `facilities.ts:66,70,82`,
`coverageAnalytics.ts:106`, `CoverageMap.tsx:1107`, plus four display-only reads).

Nothing reads any kind other than `warehouse` and `home_base`. `van` is written and never
queried by kind. So the nine kinds are **labels and filters**, and this spec says so rather
than implying they drive behaviour. If a kind ever must branch, that is a later migration.

## 6. Vans have no stored location

A van's position is **live data, not stored data** — whatever that driver's phone reports
right now. Nothing to maintain, nothing to go stale.

So `createVanFacility` inserts `lat = NULL, lng = NULL`, permanently. A van is never placed
by a person, and never placed by the system at a fabricated coordinate.
The map therefore has to distinguish **three** states, not two:

| state | shown as |
|-------|----------|
| **live** | at the driver's reported position, with the driver named |
| **stale** | at the last known position, **with how old it is** |
| **not reporting** | no position at all — *not* a pin at zero, *not* a silent absence |

This matters because the app already has this exact bug recorded. `tests/no-silent-context-default.test.ts`
exists because a missing `MyPositionProvider` returns the context's default
`{ position: null }`, which is indistinguishable from "has no position" — and
`tests/bare-layout-has-position.test.ts` exists because `/driver` hit precisely that. **A van
that stopped reporting must not look like a van that is parked.** A live position carries a
timestamp, and anything older than a stated threshold renders as *stale*, never as *here*.

## 7. Homes

`owner_username` already exists, is nullable, and **is read by nothing**. Its own comment
states the intent: *"it exists so that giving each driver their own origin later is a query
change rather than a migration."*

A person's home is a facility with `kind = 'home'` and `owner_username` set. It is optional,
and **most organisations never set one** — only this founder does, which is why §10's
onboarding must not ask for it.

A home serves two things, both of which the founder described:

- **A starting point for hot-visiting.** The order of a day's leads begins there rather than
  from wherever the last one left off.
- **A return point.** Extras may be taken to a driver's own home.

A facility may be **somebody's home and also hold stock** — the founder's does. That is the
case the old model could not express, and the reason `kind` stays a label and the *use* is
per-run (§8).

## 8. Choosing where a run loads from

### 8.1 It is per-run, not per-organisation

A run says where it loads from and where it drops off. A place carries no "depot" role,
because the founder dispatches from Bākeh, may later dispatch from a second inventory, and
may pick up from a factory — all with the same drop-off.

This is why the earlier draft's "flag vs kind vs roles" question was wrong: it assumed one
place held one job.

### 8.2 The default is what this driver last loaded from

Not a configured organisation default — **the last facility this driver loaded from.** It
uses behaviour the app already has, cannot be forgotten to maintain, and corrects itself
when the business changes.

A stored default has a failure mode that gets worse as the business grows: the moment you
add a second depot, "the default is wrong" stops being rare and becomes weekly. Deriving it
from actual behaviour has no such moment.

Cost, stated plainly: the default is **per driver**, not company-wide. Reza who always works
بکه should not inherit انبار غرب because somebody changed an organisation setting once.

### 8.3 `warehouseFor` loses its kind filter

`lib/repo/vanStock.ts:133` is `WHERE organization_id = ? AND kind = 'warehouse'`. **This
throws for the founder today**: his main inventory is his house, so a van load fails with
«انبار تعریف نشده است».

It becomes "the facility for this run's load", which §8.2 defaults and §8.1 makes per-run.
The `kind` filter goes entirely, because it is the assumption that breaks.

### 8.4 `is_default_origin` stays, and keeps its own job

It answers *"where does distance measure from"* — which is a different question from
*"where does this run load from"*, because a driver starting from home measures from home.
Merging the two is what caused the confusion this spec is untangling. It is left alone.

## 9. The picker

One entry point, both paths inside. It replaces the dead button on `/leads` and is what spec
3 reuses.

```
components/places/PlacePicker.tsx
  open → a panel:
    ▸ your facilities, scrollable, each with its chosen icon
    ▸ «اینجا نیست؟ روی نقشه مشخص کن»  → the pin flow
```

**Why one button and not two.** Two buttons grow the `/leads` toolbar, which already carries
«انتخاب همه», «تعیین موقعیت» and a sort select. A search box is ceremony at three facilities
and only wins at thirty, which is not this year. One button also degrades gracefully: at
thirty facilities the list gains a search *inside* it, and the entry point does not change.

### 9.1 What `/leads` gets

The button works, and once a position is chosen it becomes a **chip with an ✕ to clear** —
the pattern `SearchBox.tsx:470-490` already implements correctly and `/leads` never adopted.

The bug is not only the missing picker. `useLeads.ts:88` sets `sortAnchor` from GPS on load,
so **with location working the button never renders at all.** Whatever the fix, both
affordances must stay reachable: the button when nothing is set, the clearable chip when
something is.

### 9.2 Reuse

`PlacePicker` is used by `/leads` now and by the runs view in spec 3. It calls back with
coordinates **and, when one was chosen, the facility id** — so spec 3 gets *"this run loads
from Bākeh"* for free rather than re-deriving it from a lat/lng pair.

## 10. Onboarding

Asks for **one** thing:

> **کالای اصلی‌ات کجاست؟** — a name, a kind, and a location.

That is the whole first-run experience. More places are added at any time from
`/facilities`, which already exists.

**Home is never asked for.** The founder is the only person for whom a house is a normal
inventory, and an onboarding question that is wrong for every other tenant is one every other
tenant skips. Anyone who wants one sets it themselves (§7).

**Nothing is seeded**, so a fresh database has no places at all and onboarding is what fills
it. There is deliberately no placeholder row: a starter entry would have to carry an address,
and "no hard-coded address whatsoever" was the requirement.

## 11. Testing

No component tests exist in this repo, so assertable rules go in `lib/` with real failure
modes:

| rule | assertion |
|------|-----------|
| nothing is seeded | a fresh database has **zero** `facilities` rows |
| no fabricated coordinates | no code path writes `lat = 0, lng = 0` — a grep-style guard, not a behavioural test |
| null is storable | a facility saves and reads back with `lat IS NULL` |
| icon resolution | `iconFor` returns the facility's `icon_key`, else its kind's first |
| a new kind is additive | adding a kind does not change any existing facility's resolved icon |
| van position honesty | live / stale / not-reporting are three distinct renderings; a stale one never reads as current |
| home is optional | a run's default loads with no `owner_username` set anywhere |
| the default is per driver | driver A's last load does not become driver B's default |

The no-fabricated-coordinates rule is a guard rather than a behavioural test because nothing
about the *behaviour* of `0, 0` is wrong — only its existence is.

## 12. Scope

**In:** the `facilities` migration, the nine kinds, the icon catalogue, the picker, `/leads`'s
position control, onboarding, and the `warehouseFor` correction.

**Out:** spec 3's route stops and their ordering rules — from is first and in sequence, the
drop-off is off-sequence and the driver's choice. Spec 3 depends on this and does not
duplicate it.

## 13. Risks

- **The migration touches a table real rows point at.** `stock_movements.facility_id`
  references facilities. The rebuild must re-point, not drop — and the seed's own rows must be
  **deleted rather than migrated**, because those personal addresses are precisely what this
  spec exists to remove.
- **Removing `warehouseFor`'s fallback can leave an organisation with nowhere to load from.**
  That is correct behaviour: it should fail loudly at planning time rather than invent a
  warehouse. The message must name the fix («جایی برای بارگیری تعیین نکرده‌اید»), as
  «انبار تعریف نشده است» does today.
- **`icon_key` is a bare string.** An unknown key must fall back to the kind default rather
  than render nothing, so removing an icon from the catalogue degrades to a plain marker
  instead of a blank space on the map.
