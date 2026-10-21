import type { DatabaseSync } from "node:sqlite";

/** Wording the app has retired, as it may still sit in stored rows.
 *
 *  «بچ» became «سری ساخت» (what Iranian packaging prints) and «لیست» became «فهرست». The
 *  code copy changed in one commit, but RULE_SEED, OBJECTION_CARD_SEED and
 *  KPI_DEFINITION_SEED are insert-if-missing, onboarding steps are copied onto each
 *  representative when they are created, and alerts and reminders keep the title they were
 *  raised with. Every install seeded before the rename would go on showing the old words.
 *
 *  So each row is rewritten in place, and only where it still holds the old text verbatim:
 *  an organisation that edited a rule name or a KPI definition wrote something of its own,
 *  and that is not ours to overwrite. Exact matching also makes this safe to run on every
 *  open — once a row is rewritten, nothing matches it again.
 *
 *  This is the one file tests/vocabulary.test.ts lets spell the retired words.
 */
export type Rewording = { table: string; column: string; from: string; to: string };

const OLD_BATCH = "بچ";
const NEW_BATCH = "سری ساخت";

/** Batch wordings are written once, in their new form, and the old form derived from it —
 *  so the pair cannot drift apart by a typed character. */
function batch(table: string, column: string, to: string): Rewording {
  return { table, column, from: to.replaceAll(NEW_BATCH, OLD_BATCH), to };
}

const BATCH_ALERT = "سری ساخت رو به انقضا با موجودی";

export const REWORDED: Rewording[] = [
  batch("rules", "name", "سری ساخت رو به انقضا"),
  batch("rules", "action_json", JSON.stringify({ severity: "warning", category: "stock", title: BATCH_ALERT })),
  batch("alerts", "title", BATCH_ALERT),
  batch(
    "objection_cards",
    "script_fa",
    "روی قابلیت ردیابی تکیه کنید: «هر سری ساخت ما تاریخ تولید و انقضا دارد و ما دقیقاً می‌دانیم هر جعبه به کدام مغازه رفته. یک نمونه بگذارم، خودتان روی یک غذا امتحان کنید.»",
  ),
  batch(
    "kpi_definitions",
    "definition_fa",
    "فروش خالص منهای بهای تمام‌شدهٔ کالای همان سفارش‌ها (از قیمت خرید سری ساخت).",
  ),
  batch("kpi_definitions", "formula_fa", "فروش خالص − Σ (تعداد تحویل‌شده × بهای واحد سری ساخت)"),
  // «سفارش جدید» became «سفارش تازه» (one name for a new order, in buttons and notices alike).
  { table: "rules", column: "name", from: "اعلان: سفارش جدید", to: "اعلان: سفارش تازه" },
  { table: "notification_types", column: "name_fa", from: "سفارش جدید در گروه", to: "سفارش تازه در گروه" },
  {
    table: "representative_onboarding_steps",
    column: "label_fa",
    from: "تعیین لیست قیمت نماینده",
    to: "تعیین فهرست قیمت نماینده",
  },
];

export function refreshRetiredWording(db: DatabaseSync): void {
  for (const r of REWORDED) {
    db.prepare(`UPDATE ${r.table} SET ${r.column} = ? WHERE ${r.column} = ?`).run(r.to, r.from);
  }
  /* A recall reminder carries the batch code in the middle («بچ B-7 فراخوان شد — …»), so
     it matches on shape rather than verbatim. substr is 1-based: character 4 is the code. */
  db.prepare(
    `UPDATE reminders SET message = ? || substr(message, 4)
      WHERE message LIKE ? || ' % فراخوان شد — پیگیری کنید'`
  ).run(`${NEW_BATCH} `, OLD_BATCH);
}
