/* T1: one filter format for saved views, segments, rules and reports. A filter is a tree: «and» / «or» groups of conditions
 * `{ field, op, value }`. Each list offers a FIXED menu of fields (label, column, kind) so a filter can only name what the list allows,
 * and the compiler turns it into parameterised SQL: the field comes from the menu, the value is always a `?`.
 * Example: «شهر:تهران روز_از_خرید>30» = city is Tehran AND the last purchase was more than 30 days ago. */
type FilterOp = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains";
export type Cond = { field: string; op: FilterOp; value: string | number };
export type FilterNode = Cond | { op: "and" | "or"; items: FilterNode[] };
type FieldKind = "text" | "number" | "days_since" | "me";
interface FieldDef { key: string; label: string; kind: FieldKind; column: string }
export type FilterMenu = readonly FieldDef[];
export interface FilterCtx { today: string; userId: number }

const OPS: FilterOp[] = ["eq", "ne", "gt", "gte", "lt", "lte", "contains"];
const SQL_OP: Record<Exclude<FilterOp, "contains">, string> = { eq: "=", ne: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };
const MAX_DEPTH = 3;
const MAX_CONDS = 20;

/** Persian and Arabic digits to ASCII; the rest is left alone. */
const foldDigits = (s: string) => s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

const isNode = (n: unknown): n is FilterNode => typeof n === "object" && n !== null;

/** The first problem with a filter, in words; null when it only names fields and operators the menu offers. */
export function filterProblem(node: unknown, menu: FilterMenu, depth = 0, count = { n: 0 }): string | null {
  if (!isNode(node) || depth > MAX_DEPTH) return "فیلتر نامعتبر است";
  const n = node as { op?: unknown; items?: unknown; field?: unknown; value?: unknown };
  if (n.op === "and" || n.op === "or") {
    if (!Array.isArray(n.items) || n.items.length === 0) return "فیلتر نامعتبر است";
    for (const i of n.items) { const p = filterProblem(i, menu, depth + 1, count); if (p) return p; }
    return null;
  }
  if (++count.n > MAX_CONDS) return "فیلتر بیش از حد بزرگ است";
  const def = menu.find((f) => f.key === n.field);
  if (!def) return "این فیلد در این فهرست نیست";
  if (!OPS.includes(n.op as FilterOp)) return "این عملگر پذیرفته نیست";
  if (def.kind === "me") return n.value === "من" && (n.op === "eq" || n.op === "ne") ? null : "برای «من» فقط مساوی یا نامساوی";
  if (def.kind === "text") return typeof n.value === "string" && n.value.trim() !== "" && n.value.length <= 80 && (n.op === "eq" || n.op === "ne" || n.op === "contains") ? null : "مقدار متن نامعتبر است";
  return typeof n.value === "number" && Number.isFinite(n.value) && n.op !== "contains" ? null : "مقدار عددی نامعتبر است";
}

function compileNode(node: FilterNode, menu: FilterMenu, ctx: FilterCtx, alias: string, params: (string | number)[]): string {
  if ("items" in node) return `(${node.items.map((i) => compileNode(i, menu, ctx, alias, params)).join(node.op === "or" ? " OR " : " AND ")})`;
  const def = menu.find((f) => f.key === node.field)!;
  const col = `${alias}.${def.column}`;
  if (def.kind === "me") { params.push(ctx.userId); return `${col} ${node.op === "ne" ? "<>" : "="} ?`; }
  if (def.kind === "text") {
    if (node.op === "contains") { params.push(`%${String(node.value).replace(/[\\%_]/g, "\\$&")}%`); return `${col} LIKE ? ESCAPE '\\'`; }
    params.push(String(node.value));
    return `${col} ${node.op === "ne" ? "<>" : "="} ?`;
  }
  params.push(Number(node.value));
  return `${col} ${SQL_OP[node.op as keyof typeof SQL_OP]} ?`;
}

/** SQL for `AND (...)` to append to a WHERE (empty string for no filter), with its parameters. Throws on a filter the menu does not allow. */
export function compileFilter(node: FilterNode | null, menu: FilterMenu, ctx: FilterCtx, alias = "c"): { sql: string; params: (string | number)[] } {
  if (!node) return { sql: "", params: [] };
  const problem = filterProblem(node, menu);
  if (problem) throw new Error(problem);
  const params: (string | number)[] = [];
  const sql = compileOrdered(node, menu, ctx, alias, params);
  return { sql: ` AND ${sql}`, params };
}

/** A «days since» condition needs today first, then its number, so every condition pushes its own parameters in the order of its `?`. */
function compileOrdered(node: FilterNode, menu: FilterMenu, ctx: FilterCtx, alias: string, params: (string | number)[]): string {
  if ("items" in node) return `(${node.items.map((i) => compileOrdered(i, menu, ctx, alias, params)).join(node.op === "or" ? " OR " : " AND ")})`;
  const def = menu.find((f) => f.key === node.field)!;
  if (def.kind === "days_since") {
    params.push(ctx.today, Number(node.value));
    return `${alias}.${def.column} IS NOT NULL AND (CAST(? AS date) - CAST(${alias}.${def.column} AS date)) ${SQL_OP[node.op as keyof typeof SQL_OP]} ?`;
  }
  return compileNode(node, menu, ctx, alias, params);
}

/** A. Typed filters: «شهر:تهران روز_از_خرید>30 مسئول:من» becomes conditions; words that are not filters come back as `rest` (the free search text).
 *  Underscores in a value are spaces. A field name is the menu's label, with underscores for spaces. */
const TYPED = /^(.+?)(>=|<=|!=|:|=|>|<)(.+)$/;
const TYPED_OP: Record<string, FilterOp> = { ":": "contains", "=": "eq", ">": "gt", "<": "lt", ">=": "gte", "<=": "lte", "!=": "ne" };
export function parseTyped(text: string, menu: FilterMenu): { conds: Cond[]; rest: string } {
  const conds: Cond[] = [];
  const rest: string[] = [];
  for (const token of text.split(/\s+/).filter(Boolean)) {
    const m = TYPED.exec(token);
    const def = m ? menu.find((f) => f.label === m[1].replace(/_/g, " ")) : undefined;
    if (!m || !def) { rest.push(token); continue; }
    const raw = m[3].replace(/_/g, " ");
    let op = TYPED_OP[m[2]];
    let value: string | number = raw;
    if (def.kind === "number" || def.kind === "days_since") {
      const n = Number(foldDigits(raw));
      if (!Number.isFinite(n) || op === "contains") { rest.push(token); continue; }
      value = n;
    } else if (def.kind === "me") {
      if (raw !== "من") { rest.push(token); continue; }
      op = op === "ne" ? "ne" : "eq";
    } else if (op !== "contains" && op !== "eq" && op !== "ne") { rest.push(token); continue; }
    conds.push({ field: def.key, op, value });
  }
  return { conds, rest: rest.join(" ") };
}

/** A short Persian reading of one condition, for a chip. */
export function condLabel(c: Cond, menu: FilterMenu): string {
  const def = menu.find((f) => f.key === c.field);
  const sym: Record<FilterOp, string> = { eq: "=", ne: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤", contains: ":" };
  return `${def?.label ?? c.field} ${sym[c.op]} ${c.value}`;
}

/** Typed conditions as one AND group, or null for none. */
export const allOf = (conds: Cond[]): FilterNode | null => (conds.length === 0 ? null : { op: "and", items: conds });
