# Niko Etemad CRM + ERP — Distilled Design Input

**Source:** ChatGPT conversation `6a91bcc0-b388-83e9-b1b4-c2dd81cdef7a`, messages 150–169 (7 exchanges).
**Extracted:** 2026-08-28.

This document separates three things the source runs together:

- **§1 Facts** — constraints you stated about the business. Not negotiable, not proposals.
- **§2–§7 Proposals** — what ChatGPT recommended. Treat as input, not decisions.
- **§8 Gaps** — what the source never resolved. These are the brainstorming agenda.

---

## §1. Business facts (stated by you)

| # | Fact |
|---|---|
| F1 | Product line: animal butter, plant butter (margarine), and spread (blended). Brand only — no factory. |
| F2 | Manufacturing is **outsourced under contract** to a third-party plant. |
| F3 | Company name: **نیکو اعتماد** (Niko Etemad). |
| F4 | Target customers: restaurants, hotels, catering. B2B, not retail consumer. |
| F5 | **Sales have not started.** Nationwide plan; recruiting city representatives is the growth engine. |
| F6 | Central company sells **to the representative**, on **cash or bank cheque**. |
| F7 | Collections from *end customers* are the representative's problem, **not** Niko Etemad's. Niko Etemad may help the rep *win* customers (catering, hotels) but has no involvement in their receivables. |
| F8 | Reps do capillary (مویرگی) distribution in their city and acquire local customers. |
| F9 | Phone salespeople at the center take orders and create leads / new customers. |
| F10 | New customers frequently require a **free sample** before they will buy. |
| F11 | Drivers deliver per route/territory on the day that territory is served. |
| F12 | Roles defined so far in the app: **Owner/Admin, Sales Manager, Salesperson, Driver**. |
| F13 | An **Analysis & KPI tab already exists** — you sent a screenshot of it. It currently shows: sales, delivered sales, customers, average sale, daily sales, product sales, salesperson sales, order status, collections. |
| F14 | Stated goal: most future decisions should be **data-driven**, covering every employee in every position — not just sales. |

---

## §2. The one architectural rule everything else hangs on

> **Order ≠ Delivery ≠ Route ≠ Driver.** Four separate entities.

Current (what you described) vs proposed:

```
NOW:                         PROPOSED:
Salesperson                  Order
    ↓                          ↓
  Order                      Delivery
    ↓                          ↓
Driver's list                RouteStop
                               ↓
                            RouteInstance
                               ↓
                             Driver
```

Rationale given: if Order points straight at Driver, then a driver going on leave means hand-editing 70 orders. With the chain, you change `RouteInstance.driver_id` once. It also makes split shipments, partial delivery, backorder, retry, and route reassignment possible without corrupting order history.

Two corollaries the source stresses:

- **Territory ≠ Route.** Territory is geography (hierarchical, `parent_id`: province → city → district → area). Route is a distribution run over it.
- **RouteTemplate ≠ RouteInstance.** Template is "East Tehran 01, Saturdays." Instance is "East Tehran 01 on 1405-06-07, driver Reza." Snapshot the instance so changing tomorrow's template never rewrites yesterday's history.

---

## §3. Order lifecycle

### Statuses

`DRAFT` → `PENDING_REVIEW` → `CONFIRMED` → `PLANNED` → `READY` → `OUT_FOR_DELIVERY` → `DELIVERED` → `CLOSED`

Exception states: `PARTIALLY_DELIVERED`, `DELIVERY_FAILED`, `CANCELLED`, `RETURNED`

Delivery carries its **own** status: `PLANNED`, `ASSIGNED`, `LOADED`, `IN_TRANSIT`, `DELIVERED`, `FAILED`, `RETURNED`.

Order type from day one: `SALE`, `SAMPLE`, `REPLACEMENT`, `RETURN`, `OTHER`.

### Five stages

`ORDER INTAKE` → `VALIDATION` → `DISTRIBUTION PLANNING` → `DELIVERY` → `CLOSURE`

### Transition matrix (the source's closing artifact)

| From | Action | To | Who | Condition | Automation |
|---|---|---|---|---|---|
| Draft | Submit | Pending Review | Salesperson | Data complete | Run validation |
| Pending Review | Approve | Confirmed | Manager | All checks OK | Reserve stock |
| Confirmed | Plan | Planned | System | Route found | Assign route |
| Planned | Freeze | Ready | System | Route closed | Notify driver |
| Ready | Start | Out for Delivery | Driver | Route started | Timestamp |
| Out | Deliver | Delivered | Driver | POD recorded | Close order |
| Out | Fail | Failed | Driver | Reason recorded | Create retry task |
| Failed | Retry | Planned | System/Manager | Next route | Replan |

The source calls this table "the behavioural contract of your ERP" — and says backend APIs, frontend buttons, and automation jobs should all be derived from it.

### Validation checks at intake

- **Customer:** active? has address? has territory? has phone?
- **Product:** active? sellable stock? valid price?
- **Order:** qty > 0? valid price? valid delivery date? minimum order met?

Failures route to a **Review Queue**, dispatched by issue type: price → Sales Manager, stock → Warehouse/Admin, customer → Sales Manager.

### Inventory rule

Never decrement on order entry. Maintain `Available = OnHand − Reserved`.

- On confirm: `Reserved += qty`
- On delivery: `Reserved −= delivered`, `OnHand −= delivered`

### Capacity and freeze

Capacity is not just stop count — model `max_stops`, `max_weight`, `max_volume`, `max_duration`. When a route is full, do **not** fail the order: raise `CAPACITY_FULL` and propose the next route.

**Freeze Route** at a cutoff (e.g. 18:00 the day before). After freeze, emergency orders go through an explicit "add to existing route" or "move to next route" decision — both audit-logged.

### Failure and delay reason codes

Never free-text alone — always **reason code + free text**.

Failure: `CUSTOMER_CLOSED`, `CUSTOMER_UNAVAILABLE`, `WRONG_ADDRESS`, `REFUSED`, `INSUFFICIENT_STOCK`, `DAMAGED_PRODUCT`, `VEHICLE_ISSUE`, `TIME_LIMIT`, `OTHER`

Delay: `TRAFFIC`, `CUSTOMER_DELAY`, `LOADING_DELAY`, `ROUTE_ISSUE`, `VEHICLE_ISSUE`, `OTHER`

Rationale: after three months you learn "31% of failures are TIME_LIMIT" → the problem is route planning, not the driver.

**`DELIVERY_FAILED` ≠ `RETURNED`.** Failed = never handed over. Returned = handed over, then came back.

### Sample as a first-class flow

`Lead → Qualification → Sample Requested → Sample Planned → Sample Delivered → Follow-up → Converted / Lost`

Yields the single most important funnel KPI for this business: **Sample → Order conversion**, sliceable by salesperson, rep, product, territory, customer type.

---

## §4. Data model

```
CORE          Organization, User, Employee, Role, Permission
MASTER DATA   Territory, Customer, Representative, Product, Warehouse, PriceList, ReasonCode
SALES         Lead, Sample, Order, OrderItem
LOGISTICS     RouteTemplate, RouteSchedule, RouteInstance, RouteStop, DriverAssignment, Delivery
INVENTORY     Inventory, StockMovement, Reservation
WORKFLOW      Event, Task, TaskOutcome, Alert, Rule
ANALYTICS     KPI, KPIValue, Target, Scorecard
GOVERNANCE    AuditLog, Notification
```

### Field-level detail given in the source

**Customer** — `id, code, name, customer_type, phone, mobile, address, latitude, longitude, territory_id, representative_id, salesman_id, status, created_at, updated_at`
`customer_type`: `HOTEL, RESTAURANT, CATERING, CAFE, RETAIL, WHOLESALE, OTHER`

**Territory** — `id, code, name, parent_id, status`

**Representative** — `id, code, name, territory_id, status, activation_date, sales_target, created_at`

**Product** — `id, sku, name, category_id, unit, weight, volume, active, shelf_life, created_at`

**PriceList** — `id, name, customer_type, representative_id, valid_from, valid_to, status`
**PriceListItem** — `id, price_list_id, product_id, unit_price, min_quantity`

**Order** — `id, order_number, customer_id, salesman_id, order_type, status, requested_delivery_date, confirmed_delivery_date, subtotal, discount, tax, total, priority, created_at, confirmed_at, closed_at, created_by, updated_at`

**OrderItem** — `id, order_id, product_id, quantity, unit_price, discount, tax, line_total, reserved_quantity, fulfilled_quantity, cancelled_quantity, created_at`
→ `unit_price` is a **snapshot**. Yesterday's order must not reprice when today's price changes.

**Inventory** — `product_id, warehouse_id, on_hand, reserved, available`
**Warehouse** — `id, code, name, type, status` (make it independent even with one warehouse)

**Delivery** — `id, order_id, status, planned_date, actual_date, route_stop_id, delivered_quantity, failed_reason, receiver_name, delivery_note, created_at, completed_at`
→ One Order may have many Deliveries.

**RouteTemplate** — `id, code, name, territory_id, default_driver_id, max_stops, max_weight, max_volume, active`
**RouteSchedule** — `id, route_template_id, day_of_week, start_time, end_time, active`
**RouteInstance** — `id, route_template_id, date, driver_id, status, planned_start, actual_start, planned_end, actual_end, total_stops, completed_stops, created_at`
**RouteStop** — `id, route_instance_id, customer_id, sequence, status, planned_arrival, actual_arrival, latitude, longitude, notes`
**DriverAssignment** — `id, route_instance_id, driver_id, assigned_at, assigned_by, status, started_at, ended_at` (kept separate purely for history: 08:00 Reza → 09:30 Ali)

**Event** (generic, not order-specific) — `id, entity_type, entity_id, event_type, actor_id, occurred_at, metadata`
**AuditLog** (distinct from Event) — `user_id, entity_type, entity_id, action, old_value, new_value, timestamp, ip/device`
→ Event = *what happened*. Audit = *who changed what*.

**Task** — `id, type, entity_type, entity_id, assigned_to, created_by, priority, status, due_at, completed_at, outcome_id`
**TaskOutcome** — `id, task_id, outcome_type, notes, next_action, created_at`
`outcome_type`: `ORDER, SAMPLE_REQUESTED, NO_ANSWER, PRICE_OBJECTION, COMPETITOR, CALL_BACK, LOST`
→ Structured outcomes are called "the gold of your analytics." "Called the customer" is worthless data.

**Alert** — `id, type, severity, entity_type, entity_id, rule_id, status, created_at, resolved_at, resolved_by`
**Rule** — `id, code, name, entity_type, event_type, conditions, actions, priority, cooldown, active`

**KPI** — `id, code, name, entity_type, calculation_type, formula, target_type, active`
**KPIValue** — `id, kpi_id, entity_type, entity_id, period, value, target, calculated_at`
→ Generic `entity_type` means Employee / Driver / Rep / Product KPIs share one table instead of many.

### Three timestamp fields, always

`planned_at`, `actual_at`, `occurred_at` — kept separately. Planned-vs-actual is the source of most operational insight (arrival 10:00 planned / 10:17 actual → is it the route or the driver?).

### Stability vs flexibility

- **Fixed, enum/state-machine in backend:** Order status, Delivery status, Route status
- **Configurable from UI:** Rules, thresholds, reason codes, SLA, KPI targets, notifications

### Multi-tenancy

Flagged as a **now-or-never** decision. If SaaS resale to other companies is ever plausible, put `organization_id` on every business entity from the start. Retrofitting later is described as very painful. Left unanswered in the source.

---

## §5. The ten engines

Framing: instead of hiring a specialist per function, give each function an **Engine + Dashboard + Rule + Alert + Workflow**. The system detects the problem and creates a task for a named owner — it does not merely report.

The core loop:

> **Data → Detection → Explanation → Decision → Task → Action → Result → KPI**

| Engine | Job | Human needed | Priority |
|---|---|---|---|
| KPI Engine | One place that computes every metric | Low | **P0** |
| Rule Engine | `IF condition THEN action`, configurable | Low | **P0** |
| Task Engine | Turns detections into assigned work | Yes | **P0** |
| Exception Engine | Surfaces only what is abnormal | Low | **P0** |
| Audit Log | Traceability | Low | **P0** |
| Customer Health | 0–100 churn-risk score | Oversight | P1 |
| Employee Score | Per-role scorecards | Final call | P1 |
| Rep Health | Channel-partner score | Final call | P1 |
| Inventory Health | Reorder point, dead stock | Oversight | P1 |
| Daily Brief | One morning summary | Decision | P1 |
| Why Analysis | Drill-down causation | Decision | P2 |
| Opportunity / Cross-sell | Finds openings | Decision | P2 |
| Forecast | Demand prediction | Oversight | P2 |
| AI layer | Assistant on top of all of it | Heavy oversight | P3 |

### Why the KPI Engine is P0

Without it, "active customer" means 60 days on one page and 90 on another. The source calls this a data-governance disaster. One engine computes; dashboards only display.

### Rule Engine — worked examples

```
CUSTOMER_AT_RISK
  IF days_since_last_order > 1.5 × average_order_interval
  THEN status = AT_RISK; CREATE TASK type=FOLLOW_UP assign=customer.salesman priority=HIGH

SAMPLE_NOT_FOLLOWED_UP
  IF sample_delivered AND days_since_delivery >= 3 AND no_followup
  THEN CREATE TASK type=SAMPLE_FOLLOW_UP

ORDER_STALLED
  IF order.status = CONFIRMED AND now > promised_dispatch_time
  THEN ALERT DELAYED_ORDER

SALESPERSON_DECLINING
  IF sales_7d < 0.75 × salesman_avg_8w FOR 2 consecutive periods
  THEN CREATE coaching task

STOCKOUT_RISK
  IF available_stock <= reorder_point
  THEN inventory alert
```

**Cooldown is mandatory.** A customer at risk for 10 days must not generate 10 tasks. `cooldown = 7 days`.

**Alert ≠ Task.** "Customer is at risk" is an Alert. "Call the customer" is a Task. One alert may produce zero, one, or several tasks, or escalate.

**Escalation** lives in the Task Engine: assigned → deadline missed → reminder → +24h Sales Manager → +48h Owner.

### Scoring formulas given

**Customer Health** — Recency 30%, Frequency 25%, Revenue 20%, Order Trend 15%, Product Diversity 10%
Bands: 80–100 Healthy / 60–79 Stable / 40–59 At Risk / 0–39 Critical
Must be **explainable** — show the per-factor contribution, not just "42".

**Representative Health** — Purchase Growth 30%, Target Achievement 20%, Order Frequency 15%, Product Coverage 15%, New Market Activity 10%, Operational Discipline 10%
Key metric: **Rep Activation** — signed a contract but no order in 30 days = not an active rep.

**Salesperson Score** — Sales 35%, New Customers 20%, Conversion 15%, Sample Conversion 10%, Repeat Purchase 10%, Follow-up Discipline 5%, CRM Discipline 5%

**Driver Score** — On-Time Delivery 30%, Successful Stops 25%, Route Efficiency 15%, Returns 10%, Complaints 10%, Cash/Document 10%

Two cautions:
- Attach KPI templates to **Role**, not User: `Role → KPI Template → User`. People change roles; history must survive.
- Split **controllable** from **non-controllable** KPIs. A driver must not be penalised for low order volume.
- Phrase findings as problems, not verdicts: not "Ali is weak" but "Ali is below team benchmark on Sample Conversion."

### Inventory engine

Per SKU: `current_stock, reserved, available, avg_daily_sales, lead_time, safety_stock, reorder_point, stock_days`

`Reorder Point = avg_daily_sales × lead_time + safety_stock`

States: 🟢 Healthy / 🟡 Overstock / 🟠 Low Stock / 🔴 Stockout Risk / ⚫ Dead Stock
Dead stock rule: no sales > 60 days AND stock > 0 (threshold configurable).

Caveat raised: don't build the formula on past sales alone — season, holidays, Iranian occasions, price changes, promotions, supplier lead time, and production limits all matter. Rule-based first, forecasting later.

### Exception Engine — the scale argument

Out of 1,000 orders: ~970 normal, ~25 warning, ~5 critical. **The manager should see 30, not 1,000.**

Three buckets: 🔴 Critical (act now) / 🟠 Warning (investigate) / 🟢 Opportunity.
Rank by `Priority Score = Impact × Probability × Urgency`.

### Automation boundary

| Fully automatic | Semi-automatic (system suggests, human decides) | Stays human |
|---|---|---|
| KPI calculation, status changes, alerts, routine tasks, follow-up reminders, at-risk detection, stockout detection, stalled-order detection, daily report, ranking, target achievement, employee/rep scores | Coaching, discounts, cross-sell suggestions, target changes, route changes, customer prioritisation, rep recruitment, stock increases, campaigns | Firing, final hiring, legal, tax, safety/quality calls, rep contracts, pricing policy, strategy |

### Traceability (food industry)

`Customer → Order → Product → Batch → Production`, and the reverse: given a batch, which customers, which reps, which orders. Complaint clustering on a batch triggers an alert. The source is explicit that software does **not** replace a real QA specialist for safety and regulatory matters.

---

## §6. KPI catalogue

Every KPI must carry seven attributes, or it is a report and not a management system:

> **Definition · Formula · Owner · Target · Benchmark · Frequency · Action**

Backed by a `kpi_definitions` registry table and a **Data Dictionary** that fixes contested definitions once (e.g. "Active Customer = at least one confirmed order in the last 60 days").

### Tier 1 — essential
Net Sales · Gross Profit · Gross Margin · Orders · AOV · Active Customers · New Customers · Lost Customers · Repeat Purchase Rate · Collection Rate · Overdue Receivables · Inventory Value · Stockout Rate · On-Time Delivery · Order Fulfillment Rate

### Tier 2 — high value
Sales Conversion · Sample Conversion · Customer Churn · Customer Growth · Product Penetration · Cross-sell Rate · Sales per Employee · Sales per Salesperson · Revenue per Route · Revenue per Driver · Delivery Cost per Order · Cost per Stop · Route Efficiency · Return Rate · Complaint Rate

### Tier 3 — derived / predictive
Customer Health Score · Salesperson Score · Driver Score · CLV · Customer Profitability · Product Profitability · Territory Potential · Churn Probability · Cross-sell Opportunity · Demand Forecast · Stockout Prediction · Employee Performance Trend

### Operational KPIs that fall out of the Event log for free
Order Processing Time (created→confirmed) · Planning Time (confirmed→planned) · Fulfillment Time (confirmed→ready) · Delivery Time (out→delivered) · Total Lead Time (created→delivered)

### Explicitly flagged as missing from your current dashboard
**Gross Profit and Contribution Margin.** Revenue-only dashboards are called dangerous — sales can rise while profit falls. Contribution margin should be computed per product, customer, salesperson, territory, and representative.

### Charting guidance
Keep to ~10–14 visualization types: KPI Card, Bar, Line, Bullet (actual vs target), Funnel, Stacked Bar, Heatmap, Scatter/Quadrant, Treemap, Geographic Map, Waterfall (sales→cost→profit), Bump (rank over time), Box Plot (distribution), Sankey (order flow).
Deliberately limited: excess Pie, Donut, Gauge, Streamgraph, Chord, Network — pretty, not decision-grade. Bullet beats Gauge for actual-vs-target.

### Proposed dashboard sections
`01 Executive · 02 Sales · 03 Customers · 04 Products · 05 Distribution · 06 Employees · 07 Territories · 08 Finance`
Plus a separate **Action Center** — the source argues this page matters more than the dashboard, because the manager arrives to find problems delivered rather than hunting for them.

### The "Why?" button
Next to each KPI, a drill-down: Sales ↓12% → by territory → by salesperson → by funnel stage → "the drop is in Samples, not Conversion."

---

## §7. Roles, permissions, and phasing

### Permissions

| Role | Access |
|---|---|
| Owner/Admin | Everything |
| Sales Manager | Orders, customers, salespeople, routes, analytics, tasks, exceptions |
| Salesperson | Leads, **own** customers, orders, samples, tasks |
| Driver | Assigned route, assigned stops, delivery, delivery result |

Driver **can**: start route, arrive, delivered, partial, failed, return, add note, attach proof.
Driver **cannot**: change price, edit order, delete customer, set discount, freely change route.

Permission must be `Role + Territory + Ownership`, not role alone — a salesperson sees only their own customers.

Proof of delivery: receiver name, signature, photo, GPS, timestamp — all **configurable per policy**, and the authoritative timestamp is **server-side**, not the phone's clock.

### Build order

**P0 — the spine**
Order State Machine · Order/Generic Event Log · Validation Engine · RouteTemplate · RouteInstance · RouteStop · Capacity · Driver Assignment · Delivery Result · Failure Reasons · Audit Log · KPI Engine · Rule Engine · Task Engine · Alert/Exception Engine

**P1 — operational intelligence**
Auto Planning · Route Freeze · Retry Workflow · SLA · Escalation · Sample Workflow · Customer Health · Employee Performance · Rep Health · Inventory Health · Daily Brief

**P2 — advanced analysis**
Route Optimization · Why Analysis · Opportunity/Cross-sell · Demand Forecast · Dynamic Capacity · Smart Assignment · Anomaly Detection

**P3 — AI**
Only after real data exists. The stated ordering is `DATA → KPI → ANALYSIS → AUTOMATION → PREDICTION → AI`, never the reverse. Architecture must be `Database → KPI Engine → Rules/Analytics → AI → Explanation`, so AI explains grounded numbers rather than guessing.

### Staffing triggers (from the org-design answer)

Hire on a **trigger**, not on a feeling that the company got bigger:

| Position | Trigger |
|---|---|
| Data Analyst | 10+ reps, or 500 orders/day, or 5+ data sources, or managers spending 4+ h/week on reporting |
| Sales Operations | 10+ salespeople, or 100+ orders/day, or order error rate above threshold, or many stalled orders |
| Demand Planner | Many SKUs, or repeated stockouts, or overstock, or forecasting has become hard |
| HR Specialist | 30–40+ employees, or continuous hiring, or high turnover |

Top three human priorities at your current scale: **Sales Operations**, **Representative Development/Success**, and **part-time or project-based BI**. An AI specialist is explicitly ranked last.

Never outsourced away entirely: accountant/tax advisor, legal, specialist QA.

---

## §8. Open questions the source never resolved

These are the real agenda. None of them are answered anywhere in the seven exchanges.

1. **Two sales channels are conflated.** F6–F8 say you sell *to representatives*, who then sell to end customers. F9–F11 say phone salespeople take orders that *your* drivers deliver on *your* routes. The proposed `Customer` table carries both `representative_id` and `salesman_id` with no discriminator, and the whole Route/Delivery/Driver chain assumes you are doing the delivering. Which is it — do you run direct distribution in Tehran and a rep network elsewhere? Does a rep order use the same `Order` entity as a direct customer order? This decision reshapes half the data model.

2. **No money entities in the final model.** The Order has `subtotal/discount/tax/total`, but there is no Invoice, Payment, Cheque, or Receivable table in §4 — despite F6 making **bank cheques** the primary settlement instrument and despite "Collection Rate" and "Overdue Receivables" being Tier-1 KPIs. Cheque lifecycle in Iran (issued → in hand → deposited → cleared → bounced → replaced) is real state, not a field.

3. **Credit control was proposed then dropped.** The first answer put a credit check before dispatch; the final data model has no credit limit, balance, or terms. F7 arguably makes it moot for reps — but not for direct customers.

4. **Persian/Iranian realities are entirely absent.** Jalali calendar (every `date` field, every "period" in KPIValue, `day_of_week` starting Saturday), RTL layout, Persian digits and sorting, Iranian holiday calendar affecting route schedules and demand. The source writes `1405-06-07` in one place and `2026-08-29` in another without comment.

5. **Multi-tenancy is deferred with a warning attached.** `organization_id` everywhere or not — cheap now, very expensive later.

6. **Scope versus reality.** F5 says sales have not started. The P0 list is a state machine, generic event log, rule engine, task engine, exception engine, audit log, and KPI engine — a lot of machinery before the first order exists. A rule engine with no orders to evaluate detects nothing. Worth deciding what earns its place in v1 and what is designed-for but not built.

7. **The existing app is an unknown.** F13 confirms a working Analysis & KPI tab. Nothing is known here about its stack, schema, or how much of §4 already exists. Everything above is written as greenfield, which it probably is not.

8. **Sample as Order vs Sample as entity.** The source says both — `order_type = SAMPLE` in one place, "Sample will probably become an independent entity later" in another. Given F10 makes samples central to acquisition, this should be settled before build, not after.

9. **Warehouse/3PL boundary.** F2 says manufacturing is outsourced. Whose warehouse holds stock — yours, the contract manufacturer's, or both? `Inventory` is keyed by `warehouse_id`, but who updates `on_hand`, and how, is undefined.

10. **Who operates the rep's last mile?** If reps run their own capillary distribution with their own drivers, do those drivers use this system? Are their routes modelled? Or does the system stop at "sold to rep"?
