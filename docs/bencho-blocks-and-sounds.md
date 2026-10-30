# Bencho: blocks to borrow and sounds to use

Source: https://bencho.dev (read 2026-10-30). A gallery of about 150 live React UI pieces ("blocks") and 151 UI sounds that the browser makes itself. For coding agents: read this before building any motion, gesture or sound feature.

## Rules (owner decision, 2026-10-30)

1. **Rebuild on HeroUI and our tokens.** Every block is restyled on HeroUI, our colour and spacing tokens, `lib/haptic.ts`, `BottomSheet`, `StickyAction`, `CountUp`, `WordReveal`. For MIT blocks the source may be used as a starting point (keep the notice); for Pro blocks, idea only. See Licence below.
2. **Sounds: all 151 are to be used**, each given a job below. They are made in the browser (Web Audio: a few layers of tones and filtered noise per sound, no audio files), so nothing needs hosting. Built 2026-10-30 in `lib/soundRecipes.ts`: bencho.dev was read for how its sounds are made (layer shapes, the three skins), and every recipe was then written fresh for its job here. No code or numbers were copied, because the site states no licence.
3. **Sounds are on by default** (owner decision, 2026-10-30; F117 in `docs/future-features.md` had proposed off), switchable per person in the preferences blob (`lib/repo/prefs.ts`) with a master switch. Respect the phone's silent mode and reduced motion. Never play on high-frequency events (scroll, map pan, typing in a list search).
4. **One entry point.** All playback goes through one `lib/sound.ts` with an event map (`playSound("payment.saved")`), so a screen never names a raw sound. Replace a sound by editing the map only.
5. **RTL and Persian check.** Any block with a drag or swipe direction (sliders, swipe deck, slide-to-confirm, pull) must be tested right to left. Numbers must draw Persian digits (the odometer experiment already failed once on this).

## Licence (found 2026-10-30)

The site now has a licence page (`bencho.dev/licence`, dated 12 October 2026). Read it before taking any code.

- **45 free blocks are MIT.** Their full source shows in the Code pane with no account. MIT means we may copy and change it, in a product we sell, as long as the copyright notice («Copyright (c) 2026 Lorenzo Cabra» plus the MIT text) stays with substantial copies. They need `framer-motion` and `lucide-react`, both already installed.
- **105 Pro blocks** need a paid Bencho Pro account (€99 a year or €149 once), one licence per person. Without it the Code pane shows only a short "How it works" note (the key trick in 5 to 15 lines). We have not bought Pro, so for these: **idea only**, rebuilt by us from the description and that note. Do not paste the note in as code.
- **Sounds:** 24 free, the rest Pro. The licence says the 14 `mech*`, 14 `bubble*`, 14 `press*` sounds and 10 others (Keycap, Detent, Inhale, Exhale, Gust, Marimba, Murmur, Glass, Beacon, Roll) are rebuilt from **cuelume** by Daniel Belyi (MIT). Taking those from cuelume itself avoids Pro.
- The photos inside some blocks and the "Bencho" name are not covered. Use our own pictures.
- None of the blocks handle right to left or Persian digits. Every one needs that work, MIT or not.

## Blocks: every block, one verdict each

All 150 block pages were opened on 2026-10-30 (description, live preview, and the Code or "How it works" pane). Owner direction: take everything rated useful before, plus almost every block RouteFlow does not have yet; drop only the ones that truly cannot work.

- **Code:** MIT = free block, source readable and allowed. Pro = idea only.
- **Verdict:** New = RouteFlow has nothing like it. Upgrade = we have a version; borrow the idea into ours. Built = the upgrade is done (PR #30). Have it = checked 2026-10-30, our version already does it (HeroUI stacks toasts, our OTP boxes handle paste, switch stretch and sliding tab pills came with PR #27, skeletons already shimmer). Later = real but bigger, waiting for the owner's pick. Merge = same component as another row (built once). Dropped = not built (owner, 2026-10-30).
- Count: 88 New, 27 Upgrade, 27 Merge, 8 Dropped. A script checks that all 150 slugs appear exactly once.

### Field day and money (drivers, reps, cash)

| Block | Code | Verdict | Where in RouteFlow |
|---|---|---|---|
| slide-confirm | MIT | New | Driver «تحویل شد», large payment, closing a month. Replaces `confirmAction` (the browser dialog) for those three. |
| signature | MIT | New | Proof of delivery: the customer signs on the driver's phone; saved as a photo beside the delivery. |
| pay-button | Pro | New | «ثبت پرداخت»: pick cash, card or cheque on the line under the amount, pay, and it opens into the receipt. |
| folding-bill | MIT | New | Receipt preview the driver can fold away after showing the customer. |
| ticket | Pro | New | Delivery slip with a tear-off stub: the stub is the customer's copy (shared as an image). |
| crumple | Pro | New | Discard a draft order or receipt: it scrunches and goes in the bin. The «حذف» moment, with undo. |
| coin | Pro | New | Cash in hand («پول در دست») card: a coin that spins when cash is added. Light version only (see the cost question). |
| private-balance | Pro | Built | The hide-money eye (decided in the ezBookkeeping study): tap to hide amounts digit by digit, hold to peek. |
| price-flow | Pro | Built | Price change on a product or order total: new digits pop in, green up, red down. |
| rolling-counter | MIT | Built | Quantity on an order line (tap, hold to speed up, drag to fling) and totals; joins our `CountUp`. |
| stepper | Pro | Merge | Same job as rolling-counter: tap for one, hold and drag to sweep. Build as one quantity control. |
| budget-slider | Pro | New | Discount percent against the floor price: green under it, amber a little over, red well over. |
| range | Pro | New | Price range filter on products and orders, picked over the real prices. |
| asset-swap | MIT | New | Move stock between two warehouses or vans: flip the arrow to reverse, tap a side to pick another. |
| billing-card | Pro | New | Company spend this month in one coloured bar (fuel, wages, rent); was "not useful", now the cost-to-serve card. |
| heart-rate | Pro | New | A day of sales by hour: scrub the hours and the figure follows. Was a health widget; reused as the day's pulse. |

### Route and map

| Block | Code | Verdict | Where in RouteFlow |
|---|---|---|---|
| dynamic-island | MIT | New | Live run in a pill at the top: «توقف ۴ از ۱۲»; press to open the full stop card. |
| flight-island | Pro | Merge | Same pill as dynamic-island, showing the route line: from the warehouse, the van, the next stop. |
| call-island | Pro | Merge | Same pill during a call to a customer: who is on the line, hang up. |
| music-island | Pro | Merge | Same pill for a running background job (report export, sync). |
| step-player | MIT | New | Route replay: press play and each stop fills in turn. |
| time-scrubber | MIT | New | Delivery window and visit time picker (drag the ruler, it coasts to 15-minute steps). |
| segment-timer | Pro | New | Visit timer: how long the rep stayed at a customer. |
| world-clock | Pro | New | Was "not useful". Branch clocks for companies with more than one city; otherwise skip on screen. |
| orders-globe | Pro | New | Orders by city, but on an Iran map, not a globe (see the map question). |
| dot-globe | Pro | Merge | Payments arcing home to the office: same map view as orders-globe. |
| line-sphere | Pro | Merge | Decoration for the same map view while it loads. |
| hub-diagram | Pro | New | Warehouse in the middle, vans and branches around it, with live packets on the spokes. |
| blast-radius | Pro | New | Was "not useful". A customer's network: referrals ring by ring (who brought whom). |
| dot-swarm | Pro | New | Orders by hour as dots: the busy hours of the day for the planner. |
| standing-calendar | Pro | New | Half a year of visits per rep as a calendar that stands up into bars. Jalali months. |
| stacked-bars | MIT | Built | Visits and orders per day, Day/Week switch; borrow the ringed day and gliding tooltip into our charts. |
| price-chart | Pro | Built | Product price history (`PriceHistoryList` becomes a chart you scrub). |

### Lists, cards and gestures

| Block | Code | Verdict | Where in RouteFlow |
|---|---|---|---|
| swipe-deck | Pro | Built | Our `DecisionDeck` gets the throw gesture (it has buttons only today). |
| card-swap | MIT | Merge | Same deck, auto mode: today's briefing cards cycling on the home screen. |
| activity-stack | Pro | New | Notifications stacked by depth: swipe the front one away, the next rises. |
| pull | MIT | Built | Pull to refresh on every list (customers, orders, today). Not built yet. |
| roster | Pro | New | Pick people (reps, drivers) and a button grows out once someone is picked. |
| selection-actions | Pro | New | The shared selection bar: pick rows and a pill of actions appears. |
| picker | MIT | New | Assignees: pick reps for a task and their faces stack up in the pill. |
| avatar-group | Pro | New | Who is on a task or route: faces in a row, the name slides to the one under the finger. |
| profile-card | Pro | New | Tap a face to see the rep's card (phone, today's numbers). |
| access-request | Pro | New | Discount approval requests: a pill that opens into the list, each with approve and refuse. |
| liq-arrange | Pro | New | Reorder stops in a run by dragging; neighbours make room. |
| todo-tower | MIT | New | Today's tasks as a stack: take one out and the rest come down. |
| checklist | MIT | Have it | Task tick: the box fills, the tick draws, the words strike out (our task rows). |
| tree-view | Pro | New | Chart of accounts and product categories. |
| faq-accordion | Pro | New | Help page and the (?) texts. |
| pill-accordion | Pro | New | Settings groups: open one and it grows into a card. |
| image-accordion | MIT | New | Customer shop photos: tap one and it opens while the others give way. |
| carousel | MIT | Built | Our `KpiCarousel` gets the lean and swipe feel. |
| card-fan | Pro | New | Product photos fanned on the product card. |
| orbit-cards | Pro | Merge | Same photo set, shown as a turning band on wide screens. |
| album-shelf | Pro | Merge | Same photo set on wide screens (covers turn to face you). |
| folder | Pro | New | A customer's documents («مدارک») folder: point at it and the papers fan out. |
| radial-pop-out | Pro | Merge | Same documents folder, ring layout. |
| image-compare | MIT | New | Shop photo before and after (shelf before and after delivery). |
| progressive-blur | Pro | New | Caption over a shop photo, readable on any picture. |
| image-shimmer | Pro | Have it | Photo placeholder while it loads (our `Skeleton`). |
| load-cards | Pro | Built | Skeletons that develop into the real cards one by one. |
| skeleton-morph | Pro | Built | Same: grey bars stretch into the real content. |
| blueprint-loader | Pro | Built | Same family: a skeleton measured off the real card. |

### Inputs and forms

| Block | Code | Verdict | Where in RouteFlow |
|---|---|---|---|
| one-time-code | MIT | Have it | Our `OtpInput` (paste, autofill, backspace); borrow what ours lacks. |
| label-input | MIT | Built | `TextInput` label lifts into the top edge on focus. |
| form-error | Pro | Built | Field shakes once and unfolds the reason (we have `useShake`). |
| password-strength | Pro | Built | Password change and new user: a bar and rules ticked as you type. |
| copy-field | Pro | Built | Our `CopyButton` gets the drawn check and sheen (IBAN, phone, codes). |
| upload-dropzone | MIT | New | Photos and documents, with too-big refused clearly. |
| voice-note | MIT | New | Driver or rep voice note: hold to record, slide to bin. Needs object storage first. |
| seek | MIT | Have it | Our `SearchBox`: the icon opens into the field. |
| command | Pro | New | Ctrl-K command bar on desktop (planned). |
| ai-chat-input | Pro | New | Was "not useful". The message box of the native chat (no AI: the model menu becomes «پیوست» and «فوری»). |
| ai-autocomplete | Pro | New | Was "not useful". No AI: suggest the rest of a note from the rep's own past notes, kept on the server. Tab or tap to take it. |
| emoji-reactions | MIT | New | React to a note or chat message. |
| like | MIT | New | Favourites (customer, product). |
| peek-rating | Pro | Built | Our `StarRating`: stars rise and a tip names the score before you give it. |
| feedback-bar | Pro | New | "Was this helpful?" under help pages. |
| date-reel | Pro | Built | Time and Jalali date drums in `JalaliDatePicker`. |
| picker-wheel | Pro | Merge | Same drum, for long lists (product units, reasons). |
| option-wheel | Pro | Merge | Same drum, words only. |
| country-wheel | Pro | Merge | Same drum with icons: province or city picker. |
| humidity | Pro | New | A ring you drag: the van load or a percent target. |
| sleep | Pro | New | Two handles round a dial: opening hours of a shop (from, to). |
| progress | Pro | New | Scrub along ticks to set a value: daily target. |
| wake-slider | MIT | New | Settings level controls (sound volume, text size). |
| slosh | MIT | Merge | Same settings slider, with weight. One slider control, not two. |
| tape | Pro | Merge | Same slider, quarter steps: route replay speed. |
| liq-toggle | MIT | Have it | Our `ToggleSwitch` gets the stretching droplet. |
| magnet-select | MIT | Built | Our `ChipGroup` / `FilterChips`: the picked chip swells. |
| aspect | MIT | New | Crop a shop or product photo (4:3, 1:1, 3:4) before upload. |
| resize-frame | Pro | Merge | Same crop tool with live sizes. |
| palette | MIT | Have it | Our `AccentPicker`: press for a new matching palette. |

### Navigation and app shell

| Block | Code | Verdict | Where in RouteFlow |
|---|---|---|---|
| tab-bar | Pro | Have it | `BottomNav`: the picked tab opens to show its name. |
| icon-bar | Pro | Have it | `RouteTabs`: the pill stretches across to the next tab. |
| collapsing-sidebar | Pro | New | Desktop side menu that folds to icons. |
| line-sidebar | Pro | New | Long pages on desktop (help, reports): table of contents as a ruler. |
| resizable-panels | Pro | New | Desktop planner: map and list side by side, drag the divider. |
| split-view | Pro | Merge | Same as resizable-panels. |
| dock | MIT | New | Desktop quick-launch bar for managers. Phones keep the bottom bar. |
| radial | Pro | New | Long-press a customer pin on the map: call, order, navigate fan out. |
| toolbar | Pro | New | Map tool bar (draw district, measure) that remembers the last tool. |
| liq-create | MIT | New | The «+» button that spreads into the create menu (order, customer, payment, task). |
| share-pill | Pro | New | Share a report or receipt: copy link, send to the customer. |
| action-node | MIT | New | Rules and automations page: each step as a card. |
| connect-sources | Pro | New | Integrations page: SMS, Telegram, Bale, printer. Connect one and its bar fills. |
| spec-inspector | Pro | New | Was "not useful". Developer page only: check spacing on a card. Owner only. |
| sound | MIT | New | The sound on/off control and «try this sound» row (F117). |

### Feedback, toasts and loading

| Block | Code | Verdict | Where in RouteFlow |
|---|---|---|---|
| toast-stack | MIT | Have it | `ToastProvider`: three stacked, open into a list. |
| toasts | Pro | Built | The bell swings when a notification lands (`NotificationBell`). |
| confirm | Pro | Built | The button becomes its own confirm, then undo. Replaces the remaining `confirmAction` dialogs. |
| loading-state | Pro | New | Long jobs (report export, import): moving pixels, what it is doing, seconds so far. |
| thinking | Pro | Merge | Same: steps arrive and fold into one line (lead import decode). |
| shimmer-text | Pro | Merge | Same: «در حال ذخیره…» with a sweep. |
| generate | MIT | New | Was "not useful". No AI: a big photo or map tile resolving under glass while it loads. |
| dot-loader | Pro | New | The one small loader for buttons and pills. |
| trace-loader | Pro | Merge | Same family; pick one look. |
| wave-loader | Pro | Merge | Same family. |
| bounce-loader | Pro | Merge | Same family. |
| morph-loader | Pro | Merge | Same family. |
| pixel-loader | Pro | Merge | Same family. |
| blocks-loader | Pro | Merge | Same family. |
| confetti | Pro | Built | `lib/celebrate.ts`: paper that drifts instead of particles. |

### Text and moments (login, empty states, done screens, what's new)

| Block | Code | Verdict | Where in RouteFlow |
|---|---|---|---|
| text-rise | Pro | Have it | Our `WordReveal`: line, word or letter at a time. |
| text-fade | Pro | Merge | Same component, fade mode. |
| text-blur | Pro | Merge | Same component, blur mode. |
| falling-text | Pro | New | Empty "all done" screen: the words tumble, tap to put them back. |
| magnetic-letters | Pro | New | Login title leans toward the finger. |
| foggy-word | Pro | New | Login or splash: wipe the fog off the logo. |
| heat-word | MIT | New | Coverage page header: dots melt into a heat map (matches the heat layer). |
| light | Pro | New | "What's new" card: the line appears under the finger's light. |
| edge-light | Pro | New | Highlight card for the top rep of the month. |
| ascii-wake | MIT | New | Empty state art for desktop (404 page). |
| particles | MIT | New | Login background (off on cheap phones). |
| metaballs | Pro | New | Loading screen of the app shell. |
| magnetic-dots | Pro | New | Empty state background. |
| gravity-tags | Pro | New | Customer tags page: tags fall into a pile you can push. |
| glass-bubble | MIT | New | Map loupe: drag a lens to zoom a crowded spot. |
| smudge | Pro | New | 404 and error pages: smudge the picture while you wait. |
| ink-bloom | Pro | New | "What's new" slides: the next picture blooms out of the tap. |
| page-peel | Pro | New | Hidden tip under a corner of the help card. |
| tilt | MIT | New | Rep badge or achievement card that sinks under the finger. |
| code-reveal | Pro | New | Developer and API key page: picture turns into code. |

### Dropped (owner, 2026-10-30)

| Block | Code | Verdict | Where in RouteFlow |
|---|---|---|---|
| eye-tracker | MIT | Dropped | Two eyes follow the cursor. No job, and no cursor on a phone. |
| escape | MIT | Dropped | A button that runs away from you. In a work app it reads as a broken button. |
| piano | Pro | Dropped | One octave you can play. No job. |
| fold-dropdown | Pro | Dropped | A dropdown; breaks the no-dropdown rule in `docs/mobile-first-principles.md`. |
| sweep-button | Pro | Dropped | Already built: our `SweepButton` is this. |
| slingshot | MIT | Dropped | A ball you fling. Only as a hidden toy. |
| drag-ball | MIT | Dropped | A ball you squeeze. Only as a hidden toy. |
| voice-chat | Pro | Dropped | Voice room: needs a live audio server (WebRTC relay); none in Iran we can self-host cheaply yet. |

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

## Built (2026-10-30)

- `lib/soundRecipes.ts`: the 151 recipes, the 14 meanings and the skins. Plain is not a choice: it plays before sign-in, when no company is known.
- `lib/sound.ts`: `playSound(event)`, the event map (every row above is an event there), the person's switch, and the rules (on by default, off by default under reduced motion until the person turns it on, iPhone silent switch respected, two sounds closer than 60 ms keep the first, nothing in a hidden tab, `map.panned` and `map.wandered` off).
- Settings: «صدا» under settings and in the account menu (`/settings/sound`). Everyone has their own switch (`sound` in the preferences blob); the owner picks the company skin (`organizations.sound_skin`, bubble by default), and each pick plays its «ثبت شد».
- Wired so far: done check (`useDoneFlash`), refusal shake (`useShakeOn`), toasts (success, error, info), pop and burst (`item.favourited`), bottom sheet open and close, bottom bar tab, switch flip, copy, theme switch (`theme.light`, `theme.dark`), new-order ping on /sales (`order.ping`), the settings page's sample (`sound.try`, `settings.saved`). Every other event is in the map with its sound but has no caller yet: wire it when its screen is touched, and add nothing to a screen just to make it sound.
- `tests/sound.test.ts` holds this file and the code together: the 151 names here are exactly the recipes, and every recipe is reachable from an event.

## Gaps in this list

- All 151 names appear exactly once in the sound tables, and `tests/sound.test.ts` fails if that stops being true.
- Block verdicts now come from opening every page (2026-10-30). The Pro "How it works" notes were read but not copied.
- All five owner questions on the blocks are answered (see the answers table). The upgrades are being built; the rest waits for the owner's go.
- The sounds were measured (rendered offline in Chromium, loudness kept within about 10 dB of each other, nothing near clipping) but not judged by ear on a phone. Listen on a real phone and change a recipe in `lib/soundRecipes.ts` if it sounds wrong for its job.
- Android has no web signal for its silent mode; there the phone's media volume decides.
- F117 in `docs/future-features.md` stays the feature; this file is its sound sheet.

## Owner answers on the blocks (2026-10-30)

Asked one at a time; each answer is logged here as it comes.

| # | Question | Answer |
|---|---|---|
| 1 | Use the MIT source of the 45 free blocks, or rebuild from the idea? | **Use the MIT code and restyle it.** Keep the MIT notice («Copyright (c) 2026 Lorenzo Cabra» and the MIT text) in one `THIRD-PARTY-NOTICES.md`, then move each block onto HeroUI, our tokens, right to left and Persian digits. |
| 2 | Buy Bencho Pro for the other 105, or rebuild them from the idea? | **Rebuild from the idea.** No Pro purchase. Write each Pro block ourselves from its live preview and description; the public "How it works" note may guide the approach but is not pasted in. |
| 3 | Drop the 8 proposed drops? | **Drop all 8** (eye-tracker, escape, piano, fold-dropdown, sweep-button, slingshot, drag-ball, voice-chat). |
| 4 | Where may the decoration blocks (Text and moments group) appear? | **Anywhere they fit, work screens included.** Turned off automatically on weak phones (low memory or CPU cores, battery saver, reduced motion), and the company owner has an on/off switch for the whole company in company settings (a company setting, like the sound skin). |
| 5 | Which group is built first? | **Upgrades of what we have first** (the 27 Upgrade rows), then the rest. Nothing is built until the owner says go. |
