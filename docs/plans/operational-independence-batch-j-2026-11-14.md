# Operational independence, second batch: plan (2026-11-14)

Discussion and plan only. Nothing built. Builds on what exists (see section 2), not on ChatGPT's "Systematize RouteFlow Operations" blueprint as written.

Owner decision 2026-11-14: «Lean plus skills and practice mode, plus the shrunk versions of what you recommended skipping.»

## 1. Goal, in one sentence

A new person, or someone covering for an absent colleague, can do the job from the app alone, and the owner can see where one person is the only one who can do something.

## 2. What already exists (checked in the repo at main 7ce1f87)

Academy (13 shipped lessons, company lessons and categories, required per role, manager table with tutorials done), F59 handover, T13 lend, S23 leave, F82 approval cover, F102 approval inbox, F48 approvals, F107 sessions, F140 assets, EV4 audit log, worker, `docs/runbook-index.md`, tutorials with demo data. ChatGPT assumed F27, F48, F59 and the worker were unbuilt; they are built. Not built: F39 practice mode, F128 auditor role. No warehouse or dispatcher role exists in `lib/roles.ts` (nine roles).

## 3. What we build (tasks)

| ID | Task | Example | Reuses |
|---|---|---|---|
| OI4 | **Named backup.** Each person can have a backup colleague (and optionally per duty: deliveries, cash count, approvals). Leave (S23) and handover pre-fill from it. | «Reza covers Ali». Ali goes on leave: Reza is suggested, one tap to confirm. | S23, F59, F82 |
| OI5 | **Coverage view for the owner** (single-point list). Counts: people with no backup; duties only one person has done; approvals only one manager can give; required lessons overdue; skills nobody is level 3 in. Five counts side by side, no combined score. | «Cash count: only Ali, no backup». | audit log, cash counts, F133, OI6 |
| OI6 | **Skills, four levels.** A short company skill list (a manager edits it) and a level per person: learning, with supervision, alone, can teach. A manager sets the level and may attach a note. Lesson completion alone never sets a level above «learning». | Sara finished the cash lesson (learning); her manager watched her count once (with supervision). | Academy, manager table |
| OI7 | **Routine checklists with an owner.** A routine = name, owner, backup, repeat (daily, weekly, month end), a few steps. It creates the task for the owner; if the owner is on leave or absent, the backup gets it. Missed routines show on the coverage view. This is the shrunk version of «process charter» and «executable SOP»: steps stay text and links to existing screens, no step engine. | «Sunday: check unpaid cheques» owned by the accountant, backup the owner. | recurring tasks, worker, S23 |
| OI8 | **Playbooks for the missing roles** as Academy lessons: group manager, rep manager, accountant, owner (day, week, month end). A warehouse playbook waits until a warehouse role exists. | A new accountant opens «روز حسابدار». | Academy |
| OI9 | **Offboarding checklist.** One card: hand over work (F59), return assets (F140), end sessions (F107), deactivate, hand over approvals (F82), shown as done or open. | Ali leaves: five lines, four done, «assets» open. | all built |
| OI10 | **Lesson changes shrunk SOP versioning.** Editing a company lesson asks the editor one question: «ordinary fix» (nobody re-reads) or «people must re-read» (affected people see it again, see AC4). Old text is kept in the lesson history. No draft, review or approve stages. | Cheque rule changes: editor chooses «must re-read», 12 people get a card. | AC4 |
| F39 | **Practice mode.** See section 4. | A new rep takes a practice order and a practice payment. | demo seed |

Shrunk instead of built, from ChatGPT's list:
- Positions, job profiles, org units: **not tables.** The backup (OI4) and skill list (OI6) cover the need for companies with fewer than about 30 people. Revisit above that.
- RACI: **one owner and one backup per routine** (OI7). No A/R/C/I matrix.
- KPIs: **the five counts of OI5.** No index, no targets until a baseline exists.
- Process families P01 to P12: **a category list in Academy** for lessons and routines. No process tables.
- Not building: generic BPM engine, SOP approval stages, AI as authority, 13 design documents, 30 tables.

| OI11 | **Sales starter pack.** The platform owner applies a pack to a new or existing company: sales routines (daily calls, Sunday cheque check), phone-sales and field-rep playbooks, objection cards. It is a copy the company can edit. Can be switched per company with the feature switches plan. | New company gets a ready sales routine on day one. | OI7, OI8, feature switches |

**Enforcement is soft (owner, 2026-11-14):** people behind on required lessons or missed routines are flagged to managers and on the coverage view, never blocked. Hard gates (block an action until a skill level) are not built; the OI6 data allows them later.

## 4. Practice mode (F39), proposed design

- A **practice company per learner**, created from the existing demo seed, reset by the learner or a manager. Reason (ChatGPT's, accepted): a shared one mixes learners' work and makes assessment unreliable.
- A visible «حالت تمرین» bar on every screen.
- **Hard rule:** a practice company can never send SMS, Telegram, push or email, never reaches real storage, and its ledgers are separate (separate company, RLS already isolates).
- Reuses the real screens and the tutorial demo data. No second set of forms.
- Cost: one company per learner is cheap in Postgres; a nightly sweep deletes practice companies unused for 30 days.
- **Decided 2026-11-14 (owner): one practice company per learner**, not a shared one.

## 5. Order

1. OI8 (lessons, no prerequisite) and OI9 (everything it joins exists).
2. OI4 backups, then OI7 routines (needs OI4), then OI6 skills.
3. OI5 coverage view last, because it reads OI4, OI6 and OI7.
4. OI10 with the next Academy touch; F39 after OI6.

Street-first and accounting order is unchanged; this is a small batch. Each task gets an issue, one commit, placement note, tutorial check and a what's-new line, as in CLAUDE.md. Existing-solutions search: none of these needs a library (plain tables, existing recurring tasks, existing Academy).

## 6. Verified and not verified

Verified by reading the repo: the built list in section 2, the nine roles. Not verified: whether recurring tasks can name a backup (check at OI7 start), and the audit log's coverage of cash counts for OI5.

## 7. Decisions log

- 2026-11-14 owner: lean plus skills and practice mode, plus shrunk versions of the skipped items.
- 2026-11-14 owner: practice mode uses one practice company per learner.
- 2026-11-14 owner: sales starter pack (OI11) with soft enforcement only.
