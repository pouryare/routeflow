# Bencho: blocks to borrow and sounds to use

Source: https://bencho.dev (read 2026-10-30). A gallery of about 150 live React UI pieces ("blocks") and 151 UI sounds that the browser makes itself. For coding agents: read this before building any motion, gesture or sound feature.

## Rules (owner decision, 2026-10-30)

1. **Ideas only for blocks.** The site states no licence, no author and no install method. Do not copy its code. Rebuild the idea on what we already have: `framer-motion`, HeroUI, `lib/haptic.ts`, `BottomSheet`, `StickyAction`, `CountUp`, `WordReveal`.
2. **Sounds: all 151 are to be used**, each given a job below. The site says they are "synthesised in the browser" (small Web Audio recipes, no audio files), so no files need hosting. The names below are from the site; the recipe code was not readable from our network, so each one still has to be written (or its recipe read by someone with access to the site) and listened to once.
3. **Sounds are off by default**, switchable per person in the preferences blob (`lib/repo/prefs.ts`) with a master switch, as F117 in `docs/future-features.md` says. Respect the phone's silent mode and reduced motion. Never play on high-frequency events (scroll, map pan, typing in a list search).
4. **One entry point.** All playback goes through one `lib/sound.ts` with an event map (`playSound("payment.saved")`), so a screen never names a raw sound. Replace a sound by editing the map only.
5. **RTL and Persian check.** Any block with a drag or swipe direction (sliders, swipe deck, slide-to-confirm, pull) must be tested right to left. Numbers must draw Persian digits (the odometer experiment already failed once on this).

## Blocks: useful

Slug is the page `bencho.dev/blocks/<slug>`.

| Block | Where in RouteFlow | Why |
|---|---|---|
| slide-confirm | driver «تحویل شد», large payment, closing a month | A slide stops accidental taps on a moving phone. |
| one-time-code | authenticator and SMS code screen (batch A) | Six boxes with paste support is the standard. |
| rolling-counter, price-flow | totals, price change, motion plan «price roll» | Already planned; same idea as `CountUp`. |
| signature | proof of delivery | Customer signs on the driver's phone. |
| upload-dropzone | photos and documents («مدارک») | Photo upload is core. |
| toast-stack, toasts | `ToastProvider` | Several results at once stay readable. |
| skeleton-morph, load-cards, loading-state, image-shimmer | skeletons, photo placeholders | We already ship skeletons; borrow the morph into real content. |
| pull | pull to refresh on lists | Phone habit; sync status already exists. |
| swipe-deck | lead triage, duplicate deck, approvals | One card at a time, swipe to decide. |
| selection-actions, roster | shared selection bar (roadmap) | A button grows out once something is picked. |
| command | Ctrl-K | Already planned. |
| stepper | quantity on order lines | Fast plus and minus. |
| form-error, label-input, password-strength | forms (batch B validation) | Errors that wait and show clearly. |
| copy-field | IBAN, phone, codes | We have `CopyButton`; this adds feedback. |
| pay-button | save payment | Idle, busy, done states in one control. |
| confirm | destructive actions | A confirm that is not a dialog (a mobile rule). |
| budget-slider | discount percent against floor price | One bar shows the limit. |
| tab-bar | bottom bar and `RouteTabs` | Moving highlight. |
| faq-accordion | help and the (?) text | Plain, useful accordion. |
| tree-view | chart of accounts | It is a tree. |
| checklist, progress | tasks, route progress | Direct fit. |

## Blocks: maybe (only if a feature needs them)

| Block | Possible use / the doubt |
|---|---|
| price-chart, stacked-bars | We have charts already; borrow the hover feel only. |
| standing-calendar, date-reel, picker-wheel, option-wheel, picker | Planner day pick; needs Jalali dates, so custom work. |
| private-balance | Hide-money eye (decided in the ezBookkeeping study). |
| peek-rating | `StarRating` exists. |
| ai-chat-input, emoji-reactions | Native chat, after record threads. |
| avatar-group, profile-card | Assignee lists, rep card. |
| resizable-panels, split-view, collapsing-sidebar, line-sidebar | Desk layouts on wide screens only. |
| access-request | Discount approval request flow. |
| text-rise | Hero reveal, we have `WordReveal`. |
| confetti | `lib/celebrate.ts` already. |
| radial-pop-out, radial, toolbar, icon-bar, dynamic-island | Long-press quick actions, active-run status. |
| like | Favourites. |
| segment-timer, time-scrubber, step-player | Visit timer, route replay. |
| ticket, folding-bill | Invoice and receipt look. |
| image-compare, carousel | Before and after delivery photos, gallery. |
| activity-stack | History timeline. |
| voice-note | Driver note, needs storage first. |
| progressive-blur, pill-accordion, feedback-bar, share-pill, range, todo-tower, sound, shimmer-text, dot-loader | Small polish; take if the screen is touched anyway. `sound` is the on/off control for F117. |

## Blocks: not useful

| Blocks | Reason |
|---|---|
| ai-autocomplete, generate, thinking, voice-chat, connect-sources, blast-radius (network graph), hub-diagram | Need AI or foreign services; we have no foreign API. Or no matching feature. |
| orders-globe, dot-globe, line-sphere, particles, metaballs, dot-swarm, magnetic-dots, magnetic-letters, glass-bubble, ink-bloom, smudge, edge-light, light, ascii-wake, foggy-word, heat-word, text-fade, text-blur, falling-text, gravity-tags, orbit-cards, card-fan, card-swap | Decoration. No job in a sales and delivery tool, costs battery and frame rate on cheap phones. |
| slingshot, crumple, escape, slosh, liq-create, liq-arrange, liq-toggle, drag-ball, tilt, tape, seek, wake-slider, eye-tracker | Toys. Fun once, confusing at work. |
| wave-loader, bounce-loader, trace-loader, morph-loader, pixel-loader, blocks-loader, blueprint-loader | We use skeletons and one spinner; more loaders mean a less consistent app. |
| flight-island, music-island, call-island, dock, piano, coin, folder, album-shelf, image-accordion, country-wheel, world-clock, heart-rate, humidity, sleep, spec-inspector, code-reveal, action-node, magnet-select, palette, aspect, resize-frame, page-peel, fold-dropdown, asset-swap, sweep-button, billing-card, text-rise duplicates | Demo widgets for other products. `fold-dropdown` breaks the no-dropdown rule; `sweep-button` clashes with our own `SweepButton`; `billing-card` fits a subscription product we do not sell. |

## Sounds: all 151, each with a job

Names are exactly as on bencho.dev. The job is a first guess from the name, to be checked by ear. Events use the form `area.event` for the `lib/sound.ts` map.

### Core feedback (the family of 14 meanings in three skins)

Bencho gives the same 14 meanings in three skins: `mech*` (mechanical), `bubble*` (soft), `press*` (pressed key). The unprefixed ones (`type`, `select`, `open`, `close`, `navigate`, `warning`, `loading`, `ready`, `count`, `click`, `chime`) are the plain skin. **All three skins are kept (owner decision, 2026-10-30). The company owner sets the company's skin** in company settings; every person in that company then hears that skin. Each person still has their own sounds on/off switch (rule 3). The skin is a company setting, so it needs a column or settings key on the company record, not the per-person preferences blob. Until the owner picks, use `bubble*`.

| Meaning | Plain | mech | bubble | press | Used for |
|---|---|---|---|---|---|
| tap | click | mechTap | bubbleTap | pressTap | any button press |
| type | type | mechType | bubbleType | pressType | code boxes, keypad only |
| select | select | mechSelect | bubbleSelect | pressSelect | row picked, chip chosen |
| toggle | off | mechToggle | bubbleToggle | pressToggle | switch on and off |
| open | open | mechOpen | bubbleOpen | pressOpen | sheet or accordion opens |
| close | close | mechClose | bubbleClose | pressClose | sheet closes |
| success | chime | mechSuccess | bubbleSuccess | pressSuccess | order, payment, task saved |
| error | deny | mechError | bubbleError | pressError | save failed, validation failed |
| navigate | navigate | mechNavigate | bubbleNavigate | pressNavigate | tab change |
| warning | warning | mechWarning | bubbleWarning | pressWarning | below floor price, over credit limit |
| loading | loading | mechLoading | bubbleLoading | pressLoading | long wait only (over 1 s) |
| ready | ready | mechReady | bubbleReady | pressReady | sync finished, data ready |
| attention | attention | mechAttention | bubbleAttention | pressAttention | new notification |
| count | count | mechCount | bubbleCount | pressCount | counter ticks, totals rolling |

### Money and the field day

| Sound | Job |
|---|---|
| paid | payment saved (`payment.saved`) |
| thump | large payment or closing a month (heavy confirm) |
| pouch | cash added to «پول در دست» |
| landed | arrived at a stop |
| land | pin dropped on the map |
| stride | run started |
| mark | stop marked visited |
| ferry | order moved to another day or route |
| punt | visit postponed |
| hail | new order assigned to a driver |
| perk | live «سفارش تازه» ping for managers |
| crest | daily target reached |
| climb | progress step up (route or target) |
| rise | price or figure went up |
| portal | switched company |
| boot | app opened |
| knock | discount approval requested |
| snub | discount refused |
| latch | secure step passed (authenticator verified) |
| vault | secure data saved (bank details, documents) |
| bell | reminder due |
| prod | nudge on a stale follow-up |
| knell | critical alert (sync lost with unsent work) |
| groan | sync failed, will retry |
| sigh | all done for today, empty list |
| copied | copied to clipboard |
| print | receipt or invoice printed or generated |
| trash | record deleted |
| toss | item removed from an order |
| crinkle | photo discarded |
| paperTap | tap on a paper-like card (invoice, receipt) |
| rustle | list reordered |
| rim | drop missed its target (reorder cancelled) |

### Gestures and controls

| Sound | Job |
|---|---|
| drag, lift, grip, drop | reorder stops: grab, lift, hold, release |
| slide | slide-to-confirm moving |
| swoop | message or draft sent |
| sweep | refresh finished (sweep or pull-to-refresh) |
| flick | quick dismiss of a card |
| whisk | swipe on a row |
| notch | slider snaps to a step |
| fill | progress bar filling |
| expand | accordion or detail expands |
| skim | scroll snaps to the next card |
| strain | pull-to-refresh stretched |
| bump | reached a limit (min, max, end of list) |
| boing | over-limit shake on a field |
| twang | rubber-band release |
| pin | page or customer pinned |
| pat | marked as favourite |
| pick | customer picked in a search list |
| check | checkbox ticked |
| cross | tag or chip removed |
| step | stepper plus or minus |
| tock | timer tick (visit timer) |
| tamp | numbers pressed in on the keypad |
| peck | one key on the keypad |
| poke | tap on a disabled control (explains why with a toast) |
| press | press-and-hold begins |
| pop | badge or count appears |
| bop | small positive reaction |
| arc | item thrown to the bin or basket |
| dab | quick note added |
| jab | delete button pressed (before confirm) |
| cuff | row snapped to the edge (swipe action armed) |
| creak | locked item tried |
| stub | tap on a locked or closed month |
| chop | order split or line split |

### Moods, transitions and ambient (only used on rare, big moments)

| Sound | Job |
|---|---|
| lull | switch to dark theme |
| wake | switch to light theme |
| float | sheet rising to full height |
| drape | sheet settling |
| glide | page transition on wide screens |
| waft | toast appears |
| slink | toast leaves |
| hover | desktop only: hover on a chart point |
| trail | map route line drawn |
| pulse | live location tracking started |
| swim | map recentred on me |
| roam, wander | map panned (off by default, too frequent) |
| creep | long operation still working (over 5 s) |
| sway | sheet snap point changed |
| idle | idle sign-out warning |
| drone | long background job running (report export) |
| hum | quiet confirm that a background job finished |
| purr | saved quietly (draft autosave) |
| buzz | validation error on leaving a field (with haptic buzz) |
| cog | settings saved |
| shift | tab or day chip changed |
| breath | pause screen between runs |
| tone | the «try this sound» button in the sound settings |
| thud | full-page error screen (nothing saved, try again) |

## Gaps in this list

- All 151 names appear exactly once in the sound tables (checked with a script on 2026-10-30). Keep that true when editing.
- Block verdicts for about 140 blocks come from the block names and a few page reads, not from opening each one. Re-read a block's page before rebuilding it.
- No sound has been heard by us. The pairing is by name.
- Wiring: F117 in `docs/future-features.md` stays the feature; this file is its sound sheet.
