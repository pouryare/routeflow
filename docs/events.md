# Events: the list

Every fact the app writes to the `events` table with `emitEvent` or `tryEmitEvent` (`lib/repo/events.ts`). An event is saved in the same transaction as the change it describes (E2), then the rule engine reacts to it (`lib/repo/rules.ts`); a reaction that fails is retried by the worker every minute. `tests/events-list.test.ts` reads the code and fails when a name is missing here, so this list cannot rot.

**Fact or request.** Names are past tense: something happened. `reassign.requested` is the one request: a person asks for something and a manager answers.

| Event | Fact or request | Emitted by | Who reacts |
|---|---|---|---|
| `order.<action>` (one per move of the order state machine: `submit`, `passReview`, `flagCredit`, `approveCredit`, `rejectCredit`, `releaseHold`, `plan`, `unplan`, `freeze`, `startRoute`, `deliver`, `deliverPartial`, `failDelivery`, `retryDelivery`, `settle`, `cancel`, `returnOrder`, `reopen`) | fact | `lib/repo/orders.ts` (`moveOrder`), next to its `order_events` row | Notification rules `notify_order_created` (`order.submit`), `notify_order_confirmed` (`order.passReview`), `notify_order_confirmed_credit` (`order.approveCredit`), `notify_order_rejected` (`order.cancel`); the other moves have no reaction yet |
| `delivery.failed` | fact | `lib/delivery.ts` when a stop took nothing | Rules `delivery_failed_retry` (a manager task), `notify_delivery_failed` |
| `delivery.succeeded` | fact | `lib/delivery.ts` (full or partial) | Rule `notify_delivery_succeeded` |
| `payment.recorded` | fact | `lib/repo/payments.ts`, inside the payment's transaction | Rule `notify_payment_recorded` |
| `task.assigned` | fact | `lib/repo/tasks.ts`, only when a person is named | Rule `notify_task_assigned` |
| `task.escalated` | fact | `lib/repo/rules.ts` (`escalateStaleRuns`) | Rule `notify_task_escalated` |
| `lead.created` | fact | `lib/repo/crm/write.ts` (`createLead`) | None yet (funnel report EV-L1) |
| `lead.verified` | fact | `lib/repo/crm/write.ts` | None yet |
| `lead.invalidated` | fact | `lib/repo/crm/write.ts` | None yet |
| `lead.claimed` | fact | `lib/repo/crm/write.ts` (a phone seller takes a pool lead) | None yet |
| `activity.logged` | fact | `lib/repo/crm/write.ts` (a call or visit saved) | None yet |
| `stage.changed` | fact | `lib/repo/crm/write.ts` | None yet |
| `temperature.changed` | fact | `lib/repo/crm/write.ts` | None yet |
| `reassign.requested` | request | `lib/repo/crm/write.ts` (a rep found a phone owned by another group) | The task it creates for the group manager; no rule |
| `records.handed_over` | fact | `lib/repo/handover.ts` (the owner hands one person's customers and open tasks to another) | None yet (the «به شما سپرده شد» notice, E2) |
| `data.exported` | fact | `app/api/admin/data/export/route.ts` (the owner downloads the whole company as one Excel file) | None yet (the access review card can list who exported) |
| `data.imported` | fact | `lib/repo/dataIO.ts` (`applyPlan`, an Excel upload the owner confirmed; metadata counts customers, products and prices) | None yet |
| `auth.impersonation_started`, `auth.impersonation_ended` | fact | `app/api/admin/impersonate/route.ts` | None yet (the access review card reads them) |
| `system.test` | fact | `lib/repo/notification-test.ts`, a test notification only; never saved to `events` | The notification fan-out |
| `lead_import.slow` | fact | `lib/repo/leadImportNotify.ts`, handed straight to the notification fan-out; never saved to `events` | The notification fan-out |

**Missing on purpose (needed by the funnel report EV-L1):** sample requested, sample delivered, sample feedback, quote sent, customer became inactive, customer reactivated. They are added with the features that create them (F52 samples, F29 quotes, the churn sweep).

**Sweep rules** (`credit_approval_waiting`, `customer_overdue`, `expiring_batch`, `sample_followup`, `notify_cheque_due_soon`, `notify_credit_approval_waiting`, `notify_customer_overdue`, `notify_reminder_due`, `notify_task_due_soon`) are not triggered by an event: the worker's `rules.sweep` job looks for them every 5 minutes.
