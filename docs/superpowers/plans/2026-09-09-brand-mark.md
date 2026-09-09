# Brand Mark — Implementation Notes

> Spec §10 named this deliverable and explicitly reserved the mark's approval for the
> user ("The mark gets user approval before it ships") — this doc records what was
> actually decided and built, rather than a pre-written TDD task plan, since the real
> work here was iterative visual review, not code driven by tests.

**Goal:** Replace the stale placeholder mark (`public/icon.svg`'s navy #0A0E14 square +
cyan #2DE0E6 diamond, both colours dead since the 2026-09-08 substrate redesign) with a
real, approved brand mark, and wire it into every Next.js icon convention the app needs.

## What happened

Two full rounds of concepts were rejected before landing on one:

1. **Round one** — the spec's own literal idea ("the mark is the notch," a card cut from
   one corner, carried to icon scale). Rejected: wrong concept entirely, not a wrong
   execution of it.
2. **Round two** — four ideas built from the name itself (route / flow: a momentum dart,
   merging lanes, a waypoint line, a faceted pin). Not rejected outright, but the user
   asked for more, aimed specifically at "easy to use, futuristic, smart routing."
3. **Round three** — four more, aimed at that brief (a chosen path lit over faint
   alternatives, a route-node network, a live pulse riding a path, a soft flow ribbon).
   **K — Live pulse — approved.**

All twelve concepts were built as real inline SVG (not a rendered concept image — no
image-generation backend was available in this environment, and for a favicon the real
vector geometry is the more useful artifact anyway: it's literally reusable if approved).
Reviewed via a published Artifact showing each mark against the app's own real light/dark
tokens, at full size and at true 16px favicon scale inside a fake browser tab. Two real
geometry bugs were caught and fixed before the final publish: variant I originally read
as a blobby leaf/eye shape (its three overlapping curves needed to be spread apart, and
the "chosen" path changed from a curve to a straight chord for contrast against the two
wandering alternatives); variant K originally looked like it spiralled into itself (an
S-curve passing too close to the pulse dot), fixed by simplifying to one open arc.

## The approved mark

Near-black (`#101216`) rounded square (corner radius 20% of edge, matching the app's own
`--radius-2xl` proportion), containing: a white open arc (the route, `opacity: .55`), a
small dot at each end (origin/destination), and — riding the arc, not at either end — a
solid white dot inside a faint ring (the live pulse/signal, the one element that actually
earns "futuristic": nothing else in the eleven rejected concepts implied movement or
liveness, only a static path).

```
M15,72 Q50,15 85,58                              route arc
circle(15,72) r3 / circle(85,58) r3, opacity .55  origin/destination dots
circle(50,40) r13, stroke only, opacity .4        ping ring
circle(50,40) r8, solid                            pulse
```

## Files

- `app/icon.svg` — Next's file-convention icon (`app/icon.(svg|png|...)`), auto-linked
  into every page's `<head>` as `<link rel="icon" type="image/svg+xml">`.
- `public/icon.svg` — **identical content**, kept as a second copy on purpose:
  `app/icon.svg`'s own auto-generated route serves at a query-stringed URL
  (`/icon?<hash>`), not a stable path, and `manifest.ts`'s `icons` array needs one fixed
  URL for PWA installability. If the mark ever changes, both files change together.
- `app/apple-icon.png` (180×180) — Next's `apple-icon` convention, auto-linked as
  `<link rel="apple-touch-icon">`.
- `app/favicon.ico` (16×16 + 32×32) — Next's `favicon` convention (root `app/` only).
  Regenerated from the same master SVG via `scripts/gen-icons.mjs`, replacing whatever
  was previously in this file.
- `public/icons/maskable-512.png` — a 512×512 PNG rendered from a **separate** maskable
  SVG (full-bleed square, no rounded corners of its own — the OS applies its own mask —
  with the mark scaled to 70% and centred, keeping it inside the W3C maskable-icon safe
  zone). Referenced from `manifest.ts`'s `icons` array with `purpose: "maskable"`.
- `scripts/gen-icons.mjs` — the one-off generator, kept checked in (not part of the
  build) for whenever the mark needs regenerating. Uses `sharp` (already a project
  dependency, links `librsvg`) to rasterize, and hand-assembles the `.ico` container
  itself (a modern `.ico` can embed PNG data per entry directly — no third-party ICO
  encoder needed for that).

`app/manifest.ts`'s `background_color`/`theme_color` and `app/layout.tsx`'s `<title>`
were already fixed in an earlier commit on this session's substrate work
(`3f874f3`) — not stale, contrary to what spec §10 originally described; verified before
touching either file again.

## Verification

- `npm run build 2>&1 | grep -iE "warn|error"`: no output.
- The build's own route list shows `/icon.svg`, `/apple-icon.png`,
  `/manifest.webmanifest` all generated.
- A real running server's rendered `<head>` was checked directly (`curl` + grep for the
  `<link>` tags) rather than trusted from the route list alone — confirmed all three
  icon `<link>` tags render with the correct `rel`/`type`/`sizes`.
- The rasterized `app/apple-icon.png` and `public/icons/maskable-512.png` were read back
  and visually confirmed to match the approved artifact concept exactly (background,
  arc, dots, ring all present and correctly proportioned) before committing.
