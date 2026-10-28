# Company and shareholders in accounting (decisions and plan, 2026-10-28)

Brainstorm with the owner, 2026-10-28. The decisions are in "Answers so far" and "Resulting design"; the build follows in steps (see `TODO-REPORT.md`). Steps 1, 2 and 3 are built (3: `lib/repo/shareholders.ts`, the «شرکا» page, migration `1761700000000_shareholders.sql`). Step 1 and 2: commission in the ledger and a person and group on every ledger line (`lib/repo/ledgerCommission.ts`, `lib/repo/parties.ts`, migration `1761600000000_commission-in-ledger.sql`).

## What the code does today

- **The books already are the company's books.** Every journal and ledger leg carries `organization_id`, and each organization is one company (row-level security keeps them apart). Profit = revenue − COGS − expenses, derived in `lib/repo/reports.ts`, and shown on the balance sheet as a derived "سود و زیان دوره" line (code 3900). There are no closing entries by design.
- **Chart of accounts is global**, not per company (`accounts` has no `organization_id`). Equity has three accounts: 3101 سرمایه اولیه, 3102 برداشت, 3103 سود انباشته. No ledger code posts to them yet.
- **Ledger legs can name a customer or a supplier** (`ledger_entries.customer_id`, `supplier_id`). That is the only "party" (طرف حساب) dimension. There is no person, employee or shareholder dimension.
- **Commission lives outside the ledger.** Seller, driver and group-manager commission is accrued on the fly from delivered weight and recorded as paid in three side tables (`commission_payments`, `driver_commission_payments`, `manager_commission_payments`). Nothing posts to journals, and 2103 تعهدات کمیسیون is unused. So the income statement's profit is **before** commission.
- **Expenses** post Dr expense account / Cr cash or bank. The payee is only a memo. Every expense is implicitly borne by the company.
- **Discount and deductions** appear in pricing (`lib/margin/solve.ts`, percent-of-gross deductions) but not as their own ledger lines.
- **Groups** (with managers earning an override) are not a ledger dimension, so profit cannot be split per group today.

## Two readings of "company as beneficiary or responsible"

1. **The company is the party that owns the profit and bears the costs, then shareholders share in it.** This is already structurally true; the gap is shareholders, profit distribution, and getting commission into the books.
2. **Per transaction, choose who carries it: the company or a person.** For example a driver's fuel paid by the driver and deducted from commission, or a cost the group manager carries. This needs a "who is responsible" party on each cost or income line.

These lead to different designs, so it is the first question.

## Options

### A. Shareholders as a detail (تفصیلی) on equity accounts (recommended start)
- New `shareholders` table per organization (name, phone, optional link to a user).
- New `shareholdings` table with `valid_from` (same pattern as `commission_rates`), giving share % over time.
- Add `shareholder_id` to `ledger_entries`, alongside `customer_id` and `supplier_id`.
- New accounts: جاری شرکا (partners' current account), سود سهام پرداختنی (dividends payable), اندوخته قانونی (legal reserve).
- Capital in: Dr bank / Cr 3101 سرمایه (shareholder X). Drawing: Dr 3102 or جاری شرکا (X) / Cr cash.
- Profit split: at year end, net profit × each person's share (time-weighted if shares changed mid-year) → Dr 3103 سود انباشته / Cr سود سهام پرداختنی (per shareholder). Paying out: Dr سود سهام پرداختنی (X) / Cr bank.
- Pros: small, fits the current engine, reports work by filtering one column. Cons: adds a third hard-coded party column.

### B. One generic "party" (طرف حساب) dimension
- A `parties` table per organization with a kind: customer, supplier, employee, shareholder, company. `ledger_entries.party_id` replaces the per-kind columns over time.
- Covers reading 2 too: an expense can name the person responsible, commission can be posted per person, an employee advance can be tracked.
- Matches the Iranian کل / معین / تفصیلی structure that accountants expect.
- Pros: the long-term shape, one statement page for any party. Cons: larger migration (customer and supplier columns are used in many reports and tests).

### C. The company as its own party or user
- Treat "the company" as a party alongside people.
- Not recommended: every journal is already the company's, so a company party duplicates the organization and makes every leg ambiguous. Use it only as a label in reading 2 ("company carries this" = no person named).

## Things the design must handle
- **Order of deductions:** sales − returns − COGS − expenses − commission (once posted) = operating profit; then tax; then legal reserve; then what is left can be split.
- **Commission into the ledger first.** Post accruals Dr commission expense / Cr 2103 per person, and payments Dr 2103 / Cr cash. Otherwise shareholders are shown a profit that is too high.
- **Share changes over time:** a `valid_from` history and time-weighted split; or shares derived from capital balances. Which one is a question for Pourya.
- **Multi-company:** shareholders and shareholdings carry `organization_id` and RLS. One real person can hold shares in several companies; they are separate rows per company. The global chart of accounts is fine because the person is a detail, not an account.
- **Closed periods:** distribution posts in an open period; a closed year stays readable.
- **Who sees it:** owner and platform_owner only (like the balance sheet). Optionally a read-only "my share" view for a shareholder who is also a user.

## Iranian conventions that may matter (check with an accountant)
- Fiscal year normally ends at the end of Esfand; the app's periods are already Jalali months.
- Accountants expect کل / معین / تفصیلی levels; shareholders are تفصیلی under سرمایه and جاری شرکا.
- Commercial Code: for a سهامی company, one twentieth of net profit goes to اندوخته قانونی until it reaches one tenth of capital (article 140; applied to با مسئولیت محدود via article 113). Profit is distributed only after the general assembly (مجمع عمومی) approves it.
- Corporate income tax (مالیات بر درآمد اشخاص حقوقی) is a flat 25% of taxable profit under article 105, before distribution.
- An unregistered partnership (مشارکت مدنی) has none of these rules; the split follows the partners' agreement.

## Recommendation
Start with **A** (shareholders as a detail on equity, share % with `valid_from`, yearly distribution journal), and first post commission into the ledger. Design the new column so it can later be folded into **B** if per-person responsibility (reading 2) turns out to be wanted.

## Open questions (asked one at a time)

Answers so far:
- Q1 (2026-10-28): **Both.** Start with A for shareholders, and design its column so it folds into B (per-person responsibility for each cost or income) later.
- Q2 (2026-10-28): **Fixed agreed percentage**, recorded with a start date (`valid_from`); capital movements do not change it.
- Q3 (2026-10-28): **A legal-form setting per company.** Legal reserve (1/20 of net profit until 1/10 of capital) and an assembly-approval step apply only to registered companies; an unregistered partnership splits straight from the agreed %.
- Q4 (2026-10-28): **Read-only page for each shareholder.** New shareholder role with a "my share" page (own capital, %, profit, payouts only); a shareholder can be an existing staff user or a new login.
- Q5 (2026-10-28): **Yearly split plus advances anytime.** Advances (علی‌الحساب) post to جاری شرکا per shareholder and are settled at the yearly split after Esfand; the "my share" page shows a running estimate.
- Q6 (2026-10-28): **Per group as well.** Ledger lines get a group tag, shared costs are divided between groups by a rule, and shares can be held per group as well as in the whole company.

1. Which reading of "company as beneficiary or responsible" do you mean: the company owns profit and shareholders share it, or choosing per transaction whether the company or a person carries it?
2. Are shares a fixed percentage agreed between partners, or proportional to the capital each put in?
3. What legal form is the company (سهامی خاص, با مسئولیت محدود, or an unregistered partnership)? This decides legal reserve and assembly rules.
4. Should shareholders who are not staff be able to log in and see their share, or are they only records the owner manages?
5. Is profit split once a year, or monthly or quarterly as advances?
6. Is profit split for the whole company only, or per group as well?

## Resulting design (after the six answers)

1. **Commission into the ledger first.** Accruals Dr commission expense / Cr 2103 per person and per group; payments Dr 2103 / Cr cash. Profit is then after commission.
2. **Party and group on every ledger line.** Add `party_id` (option B shape, starting with shareholders and staff; customer and supplier columns fold in later) and `group_id` to `ledger_entries`. An expense or income can name the person who carries it; no person means the company carries it.
3. **Company settings:** legal form (registered or unregistered partnership). Registered turns on the legal reserve and an assembly-approval step before a split posts.
4. **Shareholders and shares:** per-company shareholders, each optionally linked to a user. Shares are fixed agreed percentages with `valid_from`, held either in the whole company or in one group. Each scope's percentages must total 100% on any date.
5. **Group profit:** each group's revenue − COGS − its own expenses − its commission, minus its part of shared costs (rule still to decide).
6. **Advances anytime:** Dr جاری شرکا (person) / Cr cash. Yearly, after Esfand: tax, then reserve (registered only), then split by days-weighted %, Dr 3103 / Cr سود سهام پرداختنی per person, and advances are netted against it.
7. **Shareholder role:** read-only "my share" page showing their capital, %, advances, running profit estimate and payouts, never other people's figures. Owner roles see everything.

- Follow-up (2026-10-28): shared costs: **both "by share of sales" and "keep at company level".** Reading taken: each shared cost account is marked either "divide by each group's share of sales" or "keep at company level" (for example rent divided, owner salary kept).

- Follow-up (2026-10-28): group losses: **the company absorbs the loss now, and the group's future profit repays the company first** before the group's shareholders get anything (tracked as a per-group loss-to-recover balance).

## More ideas (2026-10-28)

- **Working partners' salary.** A partner who also works (manager, driver) is paid a salary as an expense before profit is split, so working and silent partners are treated fairly.
- **Partner loans.** Money a partner lends the company (قرض شریک) is a liability, not capital, and does not change their share.
- **Advances beyond the share.** If advances exceed a partner's yearly share, the difference stays as money the partner owes, carried into next year.
- **Opening balances.** Each company's starting capital per partner is entered once as an opening journal.
- **Yearly partner statement.** A printable statement per partner (صورتحساب شریک): capital, share, profit, advances, payouts, balance.
- **Split preview before posting.** The owner sees the full split as a draft and confirms it; nothing posts until then.
- **Share transfers.** Selling part of a share is a new dated % for both people, so history stays readable.
