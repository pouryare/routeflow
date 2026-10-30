# GitHub labels, milestones and the project board

How issues and pull requests in this repository are labelled, grouped and tracked. It is written for one owner working with AI coding agents, so it is small on purpose: every rule here should take a few seconds to follow.

**The short version, with one example.** An agent starts the Fleetbase batch 1 work from the roadmap:

1. It opens an issue «Lists and trust (roadmap 1c, batch 1)» with the labels `type: feature`, `area: crm`, `priority: p1`, puts it in the milestone `1c Fleetbase batch 1`, and lists the F-numbers in the body.
2. Its pull request says `Closes #41` in the description and carries the same labels and milestone.
3. On merge, GitHub closes the issue, the milestone's bar moves, and the board moves the card to Done by itself.

## 1. Where things live

| Thing | Lives in | Example |
|---|---|---|
| Every idea, parked or decided | `docs/roadmap.md` and `docs/future-features.md` (F1 to F148) | F57 delivery time windows |
| Work that has been picked up | a GitHub **issue** | #41 «Lists and trust (roadmap 1c, batch 1)» |
| A bug someone found | a GitHub **issue**, opened right away | #42 «Today list hides the next task after finishing one» |
| A group of issues shipped together | a **milestone** | `1c Fleetbase batch 1` |
| What is being worked on now | the **project board** | columns Inbox, Next, In progress, In review, Done |
| The change itself | a **pull request** | PR #43, `Closes #41` |

The roadmap stays the plan. Do not copy roadmap entries into issues ahead of time: an issue is opened when work on it starts, or when a bug is found. Two lists of the same ideas drift apart.

## 2. Labels

Every label has a prefix, so the label list sorts itself into groups and a filter like `label:"area: money"` reads at a glance. Colours are shared within a group, so the group shows before the words are read.

### Type: what kind of change (exactly one)

| Label | Colour | Use for | Example |
|---|---|---|---|
| `type: bug` | `d73a4a` red | Something built does the wrong thing | A paid order still shows as owed |
| `type: feature` | `0e8a16` green | Something new a person can see or use | Delivery time windows (F57) |
| `type: improvement` | `a2eeef` light blue | A built thing made better, no new ability | Faster customer list, clearer error text |
| `type: security` | `b60205` dark red | A hole, a leak, or a missing check | SQL injection in task recurrences |
| `type: performance` | `fbca04` yellow | Speed, size, memory | Fonts no longer preloaded |
| `type: accessibility` | `f143ab` pink | Someone with a disability is blocked | A button with no label for screen readers |
| `type: docs` | `0075ca` blue | Only documents change | This file |
| `type: chore` | `c5def5` grey blue | Tooling, CI, dependencies, clean-up | Cut Actions minutes |

### Area: which part of the app (one or more)

The areas are the themes in `docs/roadmap.md` section 9, so a roadmap entry tells you its area.

| Label | Covers |
|---|---|
| `area: crm` | Customers, leads, visits, pipeline |
| `area: orders` | Orders, prices, discounts, promotions |
| `area: delivery` | Runs, routing, drivers, maps |
| `area: stock` | Warehouse, products, suppliers, purchase |
| `area: money` | Credit, payments, cheques, cash in hand |
| `area: accounting` | Ledger, reports, profit, shareholders |
| `area: people` | Users, roles, approvals, commission |
| `area: platform` | Database, server, security, sync, backups, CI |
| `area: mobile` | Phone UI, offline, input, help, motion |
| `area: messaging` | SMS, push, Telegram, telephony, chat |

All area labels are `5319e7` purple.

### Priority: how soon (exactly one on an issue)

| Label | Colour | Means | Example |
|---|---|---|---|
| `priority: p0` | `b60205` dark red | Drop everything: data loss, money wrong, security hole in use | Payments posted twice |
| `priority: p1` | `d93f0b` orange | This batch | The batch being built now |
| `priority: p2` | `fbca04` yellow | Next batch | Picked, not started |
| `priority: p3` | `c2e0c6` pale green | Some day | Nice, nobody waiting |

Pull requests do not need a priority; they take it from the issue they close.

### Status: only when something is stuck (zero or one)

| Label | Colour | Means |
|---|---|---|
| `status: needs decision` | `d4c5f9` lilac | Waiting for the owner to choose. The question also goes in an Open Question card in the project chat, with a recommended answer |
| `status: blocked` | `000000` black | Waiting on something outside the repo (a server, a supplier, a licence). The issue says what, in one line |

Everything else about status (to do, doing, in review, done) is the board's job, not a label.

### Old labels

GitHub's starter labels are folded in so nothing is lost: `bug` becomes `type: bug`, `enhancement` becomes `type: improvement`, `documentation` becomes `type: docs`, `accessibility` becomes `type: accessibility`, `question` becomes `status: needs decision`. `duplicate`, `invalid`, `wontfix`, `good first issue` and `help wanted` are removed: close an issue as **duplicate** or **not planned** instead (GitHub records the reason), and a solo repository has no newcomers to point at.

## 3. Milestones

A milestone is one batch: a group of issues and pull requests that ship together. It shows a progress bar (3 of 5 closed) and answers «how far along is this batch?».

- **Name** it after the roadmap section and the batch: `1c Fleetbase batch 1`, `1j Bigcapital money`, `Wave 1 foundations`, `Security audit 2026-10-29`. Work not from the roadmap gets a plain name: `Load time`, `Go public`.
- **Description** links the roadmap section: `docs/roadmap.md#1c-fleetbase-study-uiux-batches-decided-2026-10-30`.
- **Due date** only when there is a real date (a launch, a demo). An invented date only goes red.
- **Open** it when the batch is picked up, not before. **Close** it when its last pull request merges. Open issues left in it move to the next milestone or lose their milestone.
- One issue or pull request belongs to at most one milestone (GitHub allows only one).

## 4. The project board

One user-level project, **RouteFlow**, linked to this repository. It is a picture of what is moving now; the roadmap is the picture of everything.

**Columns (the Status field):**

| Status | Means | Gets there by |
|---|---|---|
| Inbox | New, not looked at | Auto-added when an issue is opened |
| Next | Picked for the coming batch | Moved by hand (or: has `priority: p1`/`p2` and a milestone) |
| In progress | Someone is building it | Moved when its draft pull request opens |
| In review | Pull request ready, CI running | Moved when the pull request is marked ready |
| Done | Merged or closed | Automatic on close or merge |

**Extra fields:** `Size` (S, M, L, the same meaning as in the roadmap) and `Roadmap` (text, the F-number or section, for example `F57` or `1c`). Priority, area and milestone show from the labels and the milestone, so they are not repeated as fields.

**Views:** a Board grouped by Status; a Table grouped by Milestone; a «Needs me» table filtered to `label:"status: needs decision"`.

**Built-in workflows to turn on:** Auto-add to project (this repository, `is:issue,pr is:open`), Item closed → Done, Pull request merged → Done, Item reopened → Inbox, Auto-archive items done for 14 days.

Coding agents in cloud sessions cannot edit a user-level project (that needs GitHub's GraphQL API, which is blocked there). That is fine: agents set labels and milestones, and the workflows above move the cards. The owner drags a card only to say «Next».

## 5. What every issue and pull request carries

**An issue:**

- A title that says the goal in plain words: «Show delivery windows on the driver stop», not «F57».
- Exactly one `type:`, at least one `area:`, exactly one `priority:`.
- The milestone, once its batch is picked up.
- In the body: the F-number or roadmap section if there is one, what done looks like in one to three lines, and for UI work the placement note (see `CLAUDE.md`).

**A pull request:**

- `Closes #41` (or `Closes #41, closes #42`) in the description for every issue it finishes, so merging closes them. Use `Part of #41` when it does not finish it.
- The `type:` and `area:` labels of the change. A batch pull request with several kinds of commits carries each `type:` that applies.
- The same milestone as its issues.
- Opened as a draft while work goes on (CI skips drafts; see `CLAUDE.md`), marked ready at the end.

**A pull request with no issue** is fine for small work (a typo, a one-commit fix found while doing something else). It still gets its `type:` and `area:` labels.

## 6. Setting it up and keeping it in step

`scripts/github-labels.sh` creates or updates every label above and folds in or removes the old ones. It is safe to run again: a label that already matches is left alone. It needs the GitHub CLI signed in with access to the repository:

```sh
gh auth login            # once
scripts/github-labels.sh # or: scripts/github-labels.sh owner/other-repo
```

A label added or changed in this file is added or changed in the script in the same commit, so the two never disagree.

Milestones are made one at a time when a batch starts, from the GitHub website (Issues → Milestones → New milestone) or:

```sh
gh api repos/pouryare/routeflow/milestones -f title='1c Fleetbase batch 1' \
  -f description='docs/roadmap.md#1c-fleetbase-study-uiux-batches-decided-2026-10-30'
```

The project board is made once, by hand, on the GitHub website: Profile → Projects → New project → Board, name it RouteFlow, add the fields and views from section 4, turn on the workflows from section 4, then link it to this repository (Projects tab of the repository → Link a project).
